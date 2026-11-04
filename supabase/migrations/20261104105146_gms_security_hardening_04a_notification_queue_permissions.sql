-- The push delivery queue is internal; browser roles get no table privileges.
ALTER TABLE public.serving_push_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.serving_push_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.serving_push_queue TO service_role;
