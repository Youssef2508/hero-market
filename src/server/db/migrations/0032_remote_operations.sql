-- 0032 – One business, two ways in (Phase 2 milestone 1, D-101).
--
-- An operation started from the internet is carried out here, in the shop's database, by the
-- operation's own handler, as the same user. This migration adds what that needs and nothing in the
-- business tables:
--   1. remote_operations – one row per such operation, written in the same transaction as its
--      effects, so it is carried out at most once and its outcome can always be asked for;
--   2. the same users, roles and permissions on both sides: the user row is sent whole (its
--      password is a scrypt hash, never plain text), and role_permissions and receipt_templates
--      join the synchronised tables;
--   3. a notification when a change is queued, so it is sent at once instead of at the next poll.
-- No existing row is changed.

CREATE TABLE remote_operations (
  op_id       uuid PRIMARY KEY,
  operation   text NOT NULL,
  user_id     integer,
  username    text,
  terminal    text,
  status      text NOT NULL CHECK (status IN ('applied', 'refused')),
  http_status integer,
  result      jsonb,              -- the answer, without fields that are shown only once
  error       jsonb,              -- for a refusal: { code, message }
  applied_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- A table's key may be several columns ('role_id,permission'): their values joined by '|'.
CREATE FUNCTION hm_sync_key(k text, r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(COALESCE(r->>x.part, ''), '|' ORDER BY x.ord)
    FROM unnest(string_to_array(k, ',')) WITH ORDINALITY AS x(part, ord)
$$;

-- The row as sent to the cloud. Users are sent with their password hash so the same username and
-- password work on both sides (owner, 2026-11-11); the old PIN columns stay on the PC.
CREATE OR REPLACE FUNCTION hm_sync_row(tbl text, r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tbl
    WHEN 'users' THEN r - 'pin_lookup' - 'pin_hash' - 'password_hash'
    ELSE r
  END
$$;

CREATE OR REPLACE FUNCTION hm_sync_enqueue(tbl text, key text, op text, r jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint := nextval('sync_row_version');
BEGIN
  INSERT INTO sync_outbox (table_name, pk, op, row_data, version)
  VALUES (tbl, key, op, CASE WHEN op = 'delete' THEN NULL ELSE hm_sync_row(tbl, r) END, v);
  INSERT INTO sync_row_versions (table_name, pk, version, deleted) VALUES (tbl, key, v, op = 'delete')
  ON CONFLICT (table_name, pk) DO UPDATE SET version = EXCLUDED.version, deleted = EXCLUDED.deleted;
  -- Delivered when the transaction commits; the sync agent sends the change straight away.
  PERFORM pg_notify('hm_sync_outbox', '');
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION hm_sync_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  k text := TG_ARGV[0];
  newkey text;
  oldkey text;
BEGIN
  -- Administrative bulk work (backup restore) turns capture off and re-queues afterwards.
  IF current_setting('hm.sync_capture', true) = 'off' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM hm_sync_enqueue(TG_TABLE_NAME, hm_sync_key(k, to_jsonb(OLD)), 'delete', NULL);
    RETURN NULL;
  END IF;
  newkey := hm_sync_key(k, to_jsonb(NEW));
  IF TG_OP = 'UPDATE' THEN
    oldkey := hm_sync_key(k, to_jsonb(OLD));
    IF oldkey IS DISTINCT FROM newkey THEN
      -- The key itself changed (e.g. a product's barcode): the old key is gone.
      PERFORM hm_sync_enqueue(TG_TABLE_NAME, oldkey, 'delete', NULL);
    ELSIF to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NULL; -- nothing changed
    END IF;
  END IF;
  PERFORM hm_sync_enqueue(TG_TABLE_NAME, newkey, 'upsert', to_jsonb(NEW));
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION hm_sync_snapshot(only_table text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  t record;
  n bigint := 0;
  c bigint;
BEGIN
  FOR t IN SELECT table_name, key_column FROM sync_tables
            WHERE only_table IS NULL OR table_name = only_table ORDER BY table_name LOOP
    EXECUTE format(
      'SELECT count(hm_sync_enqueue(%L, hm_sync_key(%L, to_jsonb(x)), ''upsert'', to_jsonb(x))) FROM %I x',
      t.table_name, t.key_column, t.table_name)
    INTO c;
    n := n + c;
  END LOOP;
  RETURN n;
END $$;

INSERT INTO sync_tables (table_name, key_column) VALUES
  ('remote_operations', 'op_id'), ('role_permissions', 'role_id,permission'), ('receipt_templates', 'id');
CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON remote_operations
  FOR EACH ROW EXECUTE FUNCTION hm_sync_capture('op_id');
CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION hm_sync_capture('role_id,permission');
CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON receipt_templates
  FOR EACH ROW EXECUTE FUNCTION hm_sync_capture('id');
