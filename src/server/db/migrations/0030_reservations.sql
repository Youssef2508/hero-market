-- 0030 – Temporary reservations against concurrent editing (owner, 1.5.2, D-099). Schema only.
--
--   A user who opens a preliminary supplier invoice to complete it (30 minutes) or a supplier
--   debt-payment request to decide on it (5 minutes) reserves it: reserved_by, reserved_at,
--   reserved_until and a token. While the reservation is valid (reserved_until in the future) no
--   other user may complete, cancel or decide on it; the holder's writes must carry the token.
--   Taking a reservation is a single conditional UPDATE, so of two simultaneous attempts exactly
--   one wins. Expiry is checked on every action; nothing depends on a timer. Completing, cancelling
--   or deciding clears it in the same statement. A reservation never moves money or stock.
--   Existing records start with no reservation (NULL).
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B);
-- the columns may also be dropped: no other record refers to them.

ALTER TABLE supplier_pending_invoices
  ADD COLUMN reserved_by    integer REFERENCES users(id),
  ADD COLUMN reserved_at    timestamp,
  ADD COLUMN reserved_until timestamp,
  ADD COLUMN reserve_token  text CHECK (reserve_token IS NULL OR length(reserve_token) <= 64),
  ADD CONSTRAINT supplier_pending_invoices_reservation
    CHECK ((reserved_by IS NULL) = (reserved_until IS NULL) AND (reserved_by IS NULL) = (reserve_token IS NULL));

ALTER TABLE supplier_payment_requests
  ADD COLUMN reserved_by    integer REFERENCES users(id),
  ADD COLUMN reserved_at    timestamp,
  ADD COLUMN reserved_until timestamp,
  ADD COLUMN reserve_token  text CHECK (reserve_token IS NULL OR length(reserve_token) <= 64),
  ADD CONSTRAINT supplier_payment_requests_reservation
    CHECK ((reserved_by IS NULL) = (reserved_until IS NULL) AND (reserved_by IS NULL) = (reserve_token IS NULL));
