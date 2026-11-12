-- Pairing a shop installation with this cloud (D-102). A code is made on the server, shown once,
-- valid for 15 minutes and for one use; only its hash is kept. The shop PC that presents it gives
-- the hash of a secret it made itself, which becomes the store's device token.

CREATE TABLE cloud_pairing_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code_hash   text NOT NULL,
  store_name  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  used_by     uuid                       -- the store id of the installation that used it
);

-- Wrong codes presented (any installation): after a few, every open code is cancelled.
CREATE TABLE cloud_pairing_failures (
  at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cloud_stores ADD COLUMN paired_at timestamptz;
