-- Phase 2 milestone 1 (D-101): operations started from the internet, on their way to the shop.
-- The shop carries each one out by its own handler and keeps its own record (remote_operations);
-- this table is the cloud's side of that hand-over, so an operation is never carried out twice and
-- its outcome can always be established.
--   queued        – accepted from the user, not yet handed to the shop (may still be withdrawn)
--   sent          – handed to the shop; the outcome is not known yet
--   applied       – carried out in the shop
--   refused       – the shop's rules refused it; nothing was changed
--   not_executed  – established that the shop never carried it out; nothing was changed
--   withdrawn     – taken back before it was handed over

CREATE TABLE cloud_operations (
  id           uuid PRIMARY KEY,
  store_id     uuid NOT NULL REFERENCES cloud_stores(store_id),
  seq          bigint GENERATED ALWAYS AS IDENTITY,
  operation    text NOT NULL,
  body         jsonb,                     -- NULL for operations whose data holds a password
  user_id      integer NOT NULL,
  username     text,
  terminal     text,
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'sent', 'applied', 'refused', 'not_executed', 'withdrawn')),
  http_status  integer,
  result       jsonb,                     -- without fields that are shown only once
  error        jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  done_at      timestamptz
);
CREATE INDEX cloud_operations_open ON cloud_operations (store_id, seq) WHERE status IN ('queued', 'sent');

-- What the shop last reported about itself, and when its changes last arrived.
ALTER TABLE cloud_stores
  ADD COLUMN health        jsonb,
  ADD COLUMN last_push_at  timestamptz,
  ADD COLUMN synced_at     timestamptz;   -- the shop had nothing left to send at this moment
