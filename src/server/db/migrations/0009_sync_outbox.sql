-- 0009 – Store → cloud synchronisation, PC side (stage 4 phase 4, D-042 / D-047).
--
-- Every change to a synchronised table writes, in the same transaction, one outbox row with the
-- full new row (or a deletion marker) and a version from one store-wide sequence. A committed sale
-- therefore has its outbox rows committed with it; a rolled-back sale has none. The sync agent
-- ships unacknowledged outbox rows and marks them acknowledged only after the cloud has committed
-- them. Owner commands from the cloud are applied at most once (applied_commands, unique id) in
-- the same transaction as their effects; their results sync back through the outbox.
--
-- Nothing here changes existing data. Existing rows are queued once, when the store first
-- registers with a cloud (hm_sync_snapshot), because only then is an epoch known.

CREATE TABLE sync_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  store_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  epoch         integer,          -- assigned by the cloud; NULL until registered (or after a restore)
  recover_from  jsonb,            -- after a restore: the backup's sync point, until recovered
  last_push_at  timestamp,
  last_pull_at  timestamp,
  last_check_at timestamp,
  check_ok      boolean,
  check_detail  jsonb,
  last_error    text,
  last_error_at timestamp
);
INSERT INTO sync_state DEFAULT VALUES;

CREATE SEQUENCE sync_row_version AS bigint;

CREATE TABLE sync_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  text NOT NULL,
  pk          text NOT NULL,
  op          text NOT NULL CHECK (op IN ('upsert', 'delete')),
  row_data    jsonb,                         -- NULL for deletions
  version     bigint NOT NULL,
  created_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0),
  acked_at    timestamp
);
CREATE INDEX sync_outbox_pending ON sync_outbox (id) WHERE acked_at IS NULL;
CREATE INDEX sync_outbox_acked ON sync_outbox (acked_at) WHERE acked_at IS NOT NULL;

-- Current version of every synchronised row (what the cloud must hold once everything is acked).
CREATE TABLE sync_row_versions (
  table_name  text NOT NULL,
  pk          text NOT NULL,
  version     bigint NOT NULL,
  deleted     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (table_name, pk)
);

-- Owner commands applied on this PC: inserted in the same transaction as the command's effects,
-- so a command can never be applied twice. Synchronised, so the cloud learns the outcome.
CREATE TABLE applied_commands (
  command_id  uuid PRIMARY KEY,
  type        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('applied', 'partially_applied', 'rejected')),
  detail      jsonb,
  applied_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- Tables and their key column. Secrets never leave the PC: users are sent through an allow-list,
-- and sessions, roles' permissions, receipt templates, migrations and sync bookkeeping are not sent.
CREATE TABLE sync_tables (
  table_name  text PRIMARY KEY,
  key_column  text NOT NULL
);
INSERT INTO sync_tables (table_name, key_column) VALUES
  ('products', 'barcode'), ('product_units', 'id'), ('product_barcodes', 'barcode'),
  ('stock_movements', 'id'), ('discount_rules', 'id'),
  ('clients', 'id'), ('client_ledger', 'id'),
  ('suppliers', 'id'), ('supplier_ledger', 'id'), ('supplier_purchases', 'id'), ('supplier_purchase_items', 'id'),
  ('shifts', 'id'), ('shift_audits', 'id'), ('safe_ledger', 'id'),
  ('sales', 'id'), ('sale_items', 'id'), ('sale_discounts', 'id'), ('sale_returns', 'id'),
  ('approvals', 'id'), ('checks_register', 'id'), ('expenses', 'id'), ('damaged_goods', 'id'),
  ('momkn_transactions', 'id'), ('mobile_money_transactions', 'id'),
  ('system_logs', 'id'), ('settings', 'key'), ('roles', 'id'), ('users', 'id'),
  ('applied_commands', 'command_id');

-- The row as sent to the cloud.
CREATE FUNCTION hm_sync_row(tbl text, r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tbl
    WHEN 'users' THEN jsonb_build_object(
      'id', r->'id', 'username', r->'username', 'role', r->'role', 'role_id', r->'role_id',
      'is_active', r->'is_active', 'created_at', r->'created_at', 'updated_at', r->'updated_at')
    WHEN 'roles' THEN jsonb_build_object(
      'id', r->'id', 'key', r->'key', 'name', r->'name', 'description', r->'description')
    ELSE r
  END
$$;

-- Queue one row change: outbox row + current version, in the caller's transaction.
CREATE FUNCTION hm_sync_enqueue(tbl text, key text, op text, r jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint := nextval('sync_row_version');
BEGIN
  INSERT INTO sync_outbox (table_name, pk, op, row_data, version)
  VALUES (tbl, key, op, CASE WHEN op = 'delete' THEN NULL ELSE hm_sync_row(tbl, r) END, v);
  INSERT INTO sync_row_versions (table_name, pk, version, deleted) VALUES (tbl, key, v, op = 'delete')
  ON CONFLICT (table_name, pk) DO UPDATE SET version = EXCLUDED.version, deleted = EXCLUDED.deleted;
  RETURN v;
END $$;

CREATE FUNCTION hm_sync_capture() RETURNS trigger LANGUAGE plpgsql AS $$
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
    PERFORM hm_sync_enqueue(TG_TABLE_NAME, to_jsonb(OLD)->>k, 'delete', NULL);
    RETURN NULL;
  END IF;
  newkey := to_jsonb(NEW)->>k;
  IF TG_OP = 'UPDATE' THEN
    oldkey := to_jsonb(OLD)->>k;
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

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT table_name, key_column FROM sync_tables LOOP
    EXECUTE format(
      'CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hm_sync_capture(%L)',
      t.table_name, t.key_column);
  END LOOP;
END $$;

-- Queue every current row of every synchronised table (first registration, or a new epoch after
-- a restore), or of one table (a table whose fingerprint differs from the cloud's). Returns the
-- number of rows queued.
CREATE FUNCTION hm_sync_snapshot(only_table text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  t record;
  n bigint := 0;
  c bigint;
BEGIN
  FOR t IN SELECT table_name, key_column FROM sync_tables
            WHERE only_table IS NULL OR table_name = only_table ORDER BY table_name LOOP
    EXECUTE format(
      'SELECT count(hm_sync_enqueue(%L, to_jsonb(x)->>%L, ''upsert'', to_jsonb(x))) FROM %I x',
      t.table_name, t.key_column, t.table_name)
    INTO c;
    n := n + c;
  END LOOP;
  RETURN n;
END $$;
