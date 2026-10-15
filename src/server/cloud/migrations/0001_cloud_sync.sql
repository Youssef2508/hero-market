-- Cloud side of store synchronisation (stage 4 phase 4, D-042 / D-047). Its own database: the
-- store's tables are held as versioned JSON rows, so rows may arrive in any order (no foreign keys
-- to break) and a row is replaced only by a strictly newer (epoch, version).

CREATE TABLE cloud_stores (
  store_id       uuid PRIMARY KEY,
  name           text NOT NULL DEFAULT '',
  token_hash     text NOT NULL,            -- SHA-256 of the store's device token
  current_epoch  integer,                  -- the only epoch whose changes are accepted
  max_epoch      integer NOT NULL DEFAULT 0,
  last_seen_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cloud_rows (
  store_id     uuid NOT NULL REFERENCES cloud_stores(store_id),
  table_name   text NOT NULL,
  pk           text NOT NULL,
  epoch        integer NOT NULL,
  version      bigint NOT NULL,
  deleted      boolean NOT NULL DEFAULT false,
  row_data     jsonb,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, table_name, pk)
);

-- The owner's operations, queued until the PC applies them. Status changes only when the PC's
-- outcome (its applied_commands row) arrives through the normal row sync.
CREATE TABLE cloud_commands (
  id          uuid PRIMARY KEY,
  store_id    uuid NOT NULL REFERENCES cloud_stores(store_id),
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'applied', 'partially_applied', 'rejected')),
  result      jsonb,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamp            -- as reported by the PC (shop-local time)
);
CREATE INDEX cloud_commands_pending ON cloud_commands (store_id, seq) WHERE status = 'pending';
