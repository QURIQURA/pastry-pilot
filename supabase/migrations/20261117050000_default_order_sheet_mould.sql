CREATE OR REPLACE FUNCTION public.pilot_default_order_sheet_mould()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_target uuid; v_base uuid; v_target_weight numeric; v_base_weight numeric; v_order_qty numeric;
BEGIN
 IF NEW.kind IS DISTINCT FROM 'CORE' OR NEW.slot IS DISTINCT FROM 'SHEET' THEN RETURN NEW; END IF;
 SELECT c.sheet_mould_id INTO v_target FROM public.work_sessions s
 JOIN public.orders o ON o.id=s.order_id AND o.user_id=s.user_id
 JOIN public.cake_sizes c ON c.id=COALESCE(s.cake_size_id,o.cake_size_id) AND c.user_id=s.user_id
 WHERE s.id=NEW.work_session_id AND s.user_id=NEW.user_id;
 IF v_target IS NULL THEN RETURN NEW; END IF;
 SELECT default_mould_id INTO v_base FROM public.formula_versions WHERE id=NEW.formula_version_id AND user_id=NEW.user_id;
 IF NEW.mould_id IS NOT NULL AND NEW.mould_id IS DISTINCT FROM v_base THEN RETURN NEW; END IF;
 NEW.mould_id:=v_target; NEW.capacity_id:=v_target;
 v_order_qty:=COALESCE(NULLIF(NEW.mould_qty,0),NULLIF(NEW.capacity_qty,0),1);
 NEW.mould_qty:=v_order_qty; NEW.capacity_qty:=v_order_qty;
 SELECT reference_weight_g INTO v_target_weight FROM public.moulds WHERE id=v_target AND user_id=NEW.user_id;
 SELECT reference_weight_g INTO v_base_weight FROM public.moulds WHERE id=v_base AND user_id=NEW.user_id;
 IF v_target_weight>0 AND v_base_weight>0 THEN NEW.multiplier:=ROUND(v_order_qty*v_target_weight/v_base_weight,4); END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pilot_default_order_sheet_mould_insert ON public.work_session_formula_versions;
CREATE TRIGGER pilot_default_order_sheet_mould_insert BEFORE INSERT ON public.work_session_formula_versions
FOR EACH ROW EXECUTE FUNCTION public.pilot_default_order_sheet_mould();