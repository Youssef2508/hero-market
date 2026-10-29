-- 0027 – Where a purchase's payment came from (owner, 1.5.2, D-089). Schema only.
--
--   paid_from: 'shift' (the drawer of shift_id), 'treasury' (an administrator with no open shift),
--   'outside' (an owner command from the cloud, paid outside the store). NULL: nothing was paid
--   at the purchase, or a purchase recorded before 1.5.2 (its drawer movement is in its shift).
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE supplier_purchases
  ADD COLUMN paid_from text CHECK (paid_from IS NULL OR paid_from IN ('shift', 'treasury', 'outside')),
  ADD COLUMN shift_id integer REFERENCES shifts(id);

-- A treasury payment names the purchase it paid.
ALTER TABLE treasury_ledger
  DROP CONSTRAINT treasury_ledger_ref_type_check,
  ADD CONSTRAINT treasury_ledger_ref_type_check
    CHECK (ref_type IS NULL OR ref_type IN ('shift', 'expense', 'client', 'supplier', 'supplier_purchase'));
