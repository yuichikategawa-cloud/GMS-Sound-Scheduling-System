-- Subscriptions are listed/deleted by the owning browser user.
-- Writes happen through register_serving_push_subscription(), which validates auth.uid().
ALTER TABLE public.serving_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.serving_push_subscriptions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE ON TABLE public.serving_push_subscriptions FROM authenticated;
GRANT SELECT, DELETE ON TABLE public.serving_push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.serving_push_subscriptions TO service_role;
