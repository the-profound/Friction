-- Ensure the tables that drive recipient-side "incoming item" screens are
-- part of the Supabase realtime publication so the friction app's realtime
-- subscriptions receive sub-second push updates instead of relying on
-- polling. Each statement is wrapped in a DO block so the migration is
-- idempotent: it succeeds whether or not the publication exists and whether
-- or not a given table is already a member.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inbox',
    'neighbor_requests',
    'neighbors',
    'team_collection_memberships',
    'team_collection_articles'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
