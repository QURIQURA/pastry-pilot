ALTER TABLE public._sync_debug_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._ddl_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._sync_debug_log FROM anon, authenticated;
REVOKE ALL ON public._ddl_probe FROM anon, authenticated;
GRANT ALL ON public._sync_debug_log TO service_role;
GRANT ALL ON public._ddl_probe TO service_role;

DROP POLICY IF EXISTS "order-moodboards public read" ON storage.objects;
DROP POLICY IF EXISTS "product-images public read" ON storage.objects;
CREATE POLICY "order-moodboards owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'order-moodboards' AND owner_id = (select auth.uid()::text));
CREATE POLICY "product-images owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-images' AND owner_id = (select auth.uid()::text));