-- 0010 – Cloud link settings, whole-transaction batches, recovery after a restore (stage 4 phase 4).
-- Changes no existing business data.

-- The transaction that wrote each outbox row: the agent never splits one local transaction
-- across two batches, so the cloud applies a sale (or a receipt, a return…) all or nothing.
ALTER TABLE sync_outbox ADD COLUMN tx_id xid8 NOT NULL DEFAULT pg_current_xact_id();

-- The cloud link (set by an administrator). The device token stays on this PC: sync_state is not
-- part of backups and is never synchronised.
ALTER TABLE sync_state
  ADD COLUMN cloud_url     text,
  ADD COLUMN device_token  text,
  ADD COLUMN enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN linked_at     timestamp,
  -- After a restore of a store that was synchronised: writes wait until the rows that reached the
  -- cloud after the backup are written back (or an administrator skips that, logged).
  ADD COLUMN recovery_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN recovered_at  timestamp,
  ADD COLUMN recovery_detail jsonb;
