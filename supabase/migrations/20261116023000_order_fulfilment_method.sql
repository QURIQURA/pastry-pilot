alter table public.orders add column if not exists fulfilment_method text not null default 'PICKUP' check(fulfilment_method in ('PICKUP','DELIVERY'));
CREATE OR REPLACE FUNCTION public.sync_confirmed_order_to_planner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
  v_secret text;
  v_task_name text;
  v_product_name text;
  v_customer_name text;
  v_size text;
  v_project_id uuid;
  v_delivery_task_id uuid;
  v_link_task_id uuid;
  v_due_time text;
  v_order_link_title text;
begin
  -- Popups use their own project receiver and never create cake Delivery tasks.
  if NEW.order_kind = 'POPUP' then return NEW; end if;
  if TG_OP = 'UPDATE'
     and NEW.status is not distinct from OLD.status
     and NEW.product_id is not distinct from OLD.product_id
     and NEW.recipient is not distinct from OLD.recipient
     and NEW.pickup_at is not distinct from OLD.pickup_at
     and NEW.fulfilment_method is not distinct from OLD.fulfilment_method
     and NEW.product_line is not distinct from OLD.product_line
     and NEW.customer_id is not distinct from OLD.customer_id
     and NEW.cake_size_id is not distinct from OLD.cake_size_id
     and NEW.product_size_id is not distinct from OLD.product_size_id
  then
    return NEW;
  end if;

  if NEW.status is distinct from 'CONFIRMED' then
    return NEW;
  end if;

  select name into v_product_name from public.products where id = NEW.product_id;
  select name into v_customer_name from public.customers where id = NEW.customer_id;

  -- 2026-11-05: 프로젝트 제목 = 고객 - 받는사람 - 제품 · 완성 사이즈(약어: 모양-사이즈-높이)
  if NEW.cake_size_id is not null then
    select name into v_size from public.cake_sizes where id = NEW.cake_size_id;
  end if;
  if NEW.product_size_id is not null then
    select
      case shape
        when 'ROUND' then 'Ø' || trim_scale(round(diameter_mm / 25.4 * 2) / 2)::text || '″'
        when 'SQUARE' then '■' || trim_scale(round(coalesce(width_mm, length_mm) / 25.4 * 2) / 2)::text || '″'
        else '▬' || trim_scale(length_mm / 10)::text || '×' || trim_scale(width_mm / 10)::text
      end
      || case when height_mm is not null then '-H' || trim_scale(height_mm / 10)::text else '' end
    into v_size
    from public.product_sizes where id = NEW.product_size_id;
  end if;

  v_task_name := nullif(concat_ws(' - ', v_customer_name, NEW.recipient, v_product_name), '');
  if v_task_name is null then
    v_task_name := 'Order';
  end if;
  if v_size is not null and v_size <> '' then
    v_task_name := v_task_name || ' · ' || v_size;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'wann_os_secret_key';

  if v_secret is null then
    raise warning 'wann_os_secret_key not found in vault, skipping planner sync for order %', NEW.id;
    return NEW;
  end if;

  v_project_id := coalesce(NEW.wann_project_id, gen_random_uuid());
  v_delivery_task_id := coalesce(NEW.wann_delivery_task_id, gen_random_uuid());
  v_link_task_id := coalesce(NEW.wann_order_link_task_id, gen_random_uuid());

  v_due_time := case when NEW.pickup_at is not null
                      then to_char(NEW.pickup_at at time zone 'Australia/Sydney', 'HH24:MI:SS')
                      else null end;

  v_order_link_title := coalesce(NEW.order_number, '주문 상세 보기');

  perform net.http_post(
    url := 'https://txrxzsrjqwhvjosutotp.supabase.co/rest/v1/rpc/sync_kora_order',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_secret,
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object(
      'p_project', jsonb_build_object(
        'id', v_project_id,
        'user_id', '1f1dd73b-cfa9-47d3-855b-f1d58283885f',
        'name', v_task_name,
        'category_id', 'c8068046-5bb0-4043-acbb-60f862fcad52',
        'date', case when NEW.wann_project_id is null
                      then (now() at time zone 'Australia/Sydney')::date::text
                      else null end,
        'end_date', (NEW.pickup_at at time zone 'Australia/Sydney')::date::text,
        'product_line', NEW.product_line
      ),
      'p_delivery_task', jsonb_build_object(
        'id', v_delivery_task_id,
        'user_id', '1f1dd73b-cfa9-47d3-855b-f1d58283885f',
        'title', case when NEW.fulfilment_method = 'DELIVERY' then 'Delivery' else 'Pickup' end,
        'multiple_task_id', v_project_id,
        'due_date', (NEW.pickup_at at time zone 'Australia/Sydney')::date::text,
        'due_time', v_due_time,
        'category_id', 'c8068046-5bb0-4043-acbb-60f862fcad52'
      ),
      'p_order_link_task', jsonb_build_object(
        'id', v_link_task_id,
        'user_id', '1f1dd73b-cfa9-47d3-855b-f1d58283885f',
        'title', v_order_link_title,
        'multiple_task_id', v_project_id,
        'category_id', 'c8068046-5bb0-4043-acbb-60f862fcad52',
        'link_url', 'https://id-preview--e2009f44-8619-4e71-8a9f-20dc744ceeb9.lovable.app/orders/' || NEW.id::text
      )
    )
  );

  if NEW.wann_project_id is null or NEW.wann_delivery_task_id is null or NEW.wann_order_link_task_id is null then
    update public.orders
    set wann_project_id = v_project_id,
        wann_delivery_task_id = v_delivery_task_id,
        wann_order_link_task_id = v_link_task_id
    where id = NEW.id;
  end if;

  return NEW;
end;
$function$
