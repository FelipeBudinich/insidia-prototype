-- Application-owned private schema. Never exposed to Supabase's Data API.
CREATE SCHEMA IF NOT EXISTS insidia2;
REVOKE ALL ON SCHEMA insidia2 FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS insidia2.schema_version (id integer PRIMARY KEY CHECK(id=1), version integer NOT NULL);
INSERT INTO insidia2.schema_version VALUES (1,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS insidia2.keys (id integer PRIMARY KEY CHECK(id=1), fingerprints jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS insidia2.epochs (epoch uuid PRIMARY KEY, fence bigint UNIQUE NOT NULL, started_at timestamptz NOT NULL, recovered_at timestamptz);
CREATE TABLE IF NOT EXISTS insidia2.owner (id integer PRIMARY KEY CHECK(id=1), epoch uuid REFERENCES insidia2.epochs(epoch), fence bigint NOT NULL);
CREATE TABLE IF NOT EXISTS insidia2.records (family text NOT NULL CHECK(family IN ('room','session','sealed','incident')), id text NOT NULL, version bigint NOT NULL, write_id uuid NOT NULL UNIQUE, body jsonb NOT NULL, PRIMARY KEY(family,id));
CREATE TABLE IF NOT EXISTS insidia2.nonces (nonce text PRIMARY KEY, owner text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS insidia2.events (room_id uuid NOT NULL, state_version bigint NOT NULL, event_id uuid NOT NULL UNIQUE, epoch uuid NOT NULL REFERENCES insidia2.epochs(epoch), fence bigint NOT NULL, previous_hash text NOT NULL, state_hash text NOT NULL, body jsonb NOT NULL, PRIMARY KEY(room_id,state_version));
CREATE TABLE IF NOT EXISTS insidia2.receipts (principal text NOT NULL, command_id uuid NOT NULL, digest text NOT NULL, status text NOT NULL CHECK(status IN ('pending','final')), ingress bigint GENERATED ALWAYS AS IDENTITY, body jsonb NOT NULL, PRIMARY KEY(principal,command_id));
CREATE INDEX IF NOT EXISTS pending_ingress ON insidia2.receipts(ingress) WHERE status='pending';
CREATE TABLE IF NOT EXISTS insidia2.bindings (session_digest text NOT NULL, generation integer NOT NULL, room_id uuid NOT NULL, player_id uuid NOT NULL, bound_at timestamptz NOT NULL, released_at timestamptz, PRIMARY KEY(session_digest,generation));
CREATE UNIQUE INDEX IF NOT EXISTS one_live_membership ON insidia2.bindings(session_digest) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_live_seat ON insidia2.bindings(room_id,player_id) WHERE released_at IS NULL;
CREATE TABLE IF NOT EXISTS insidia2.codes (digest text PRIMARY KEY, room_id uuid UNIQUE NOT NULL, generation integer NOT NULL);
ALTER TABLE insidia2.schema_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE insidia2.codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA insidia2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA insidia2 FROM PUBLIC, anon, authenticated;
-- The login is provisioned separately with a random password; no credentials
-- are kept in migration source. Run the following grants after provisioning it.
GRANT USAGE ON SCHEMA insidia2 TO insidia2_server;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA insidia2 TO insidia2_server;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA insidia2 TO insidia2_server;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='insidia2' LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='insidia2' AND tablename=t AND policyname='server_only') THEN
   EXECUTE format('CREATE POLICY server_only ON insidia2.%I TO insidia2_server USING (true) WITH CHECK (true)',t);
  END IF;
 END LOOP;
END $$;
