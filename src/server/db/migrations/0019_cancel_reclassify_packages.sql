-- 0019 – Owner requests of 2026-10-21 evening (D-065). Schema only; no stored value changes.
--
--   1. A preliminary supplier invoice can be cancelled (status "cancelled", never deleted), with
--      who, when, the request id, and whether the supplier returned the money paid.
--   2. Movement kind / treasury kind "supplier_refund": money a supplier gave back.
--   3. A payment method correction may concern a sale of a closed shift (after_close): it
--      reclassifies the sale only; the closed shift's saved close is not rewritten.
--   4. A package may carry the purchase price the owner enters for one package.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE supplier_pending_invoices
  DROP CONSTRAINT supplier_pending_invoices_status_check,
  ADD CONSTRAINT supplier_pending_invoices_status_check
    CHECK (status IN ('pending', 'converted', 'cancelled')),
  ADD COLUMN cancelled_by  integer REFERENCES users(id),
  ADD COLUMN cancelled_at  timestamp,
  ADD COLUMN cancel_ref    text UNIQUE CHECK (cancel_ref IS NULL OR length(cancel_ref) <= 120),
  ADD COLUMN cancel_refund text CHECK (cancel_refund IS NULL OR cancel_refund IN ('none', 'returned')),
  ADD COLUMN cancel_method text CHECK (cancel_method IS NULL OR cancel_method IN ('cash', 'visa', 'wallet', 'instapay')),
  ADD COLUMN cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300);

-- The "converted needs its purchase" rule, re-stated with the new status (its generated name
-- differs between databases, so it is found by its definition).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'supplier_pending_invoices'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%purchase_id IS NOT NULL%' LOOP
    EXECUTE format('ALTER TABLE supplier_pending_invoices DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE supplier_pending_invoices ADD CONSTRAINT supplier_pending_invoices_state_check CHECK (
  (status = 'pending' AND purchase_id IS NULL AND cancelled_at IS NULL)
  OR (status = 'converted' AND purchase_id IS NOT NULL AND converted_at IS NOT NULL)
  OR (status = 'cancelled' AND purchase_id IS NULL AND cancelled_at IS NOT NULL AND cancel_refund IS NOT NULL));

ALTER TABLE safe_ledger
  DROP CONSTRAINT safe_ledger_kind_check,
  ADD CONSTRAINT safe_ledger_kind_check
    CHECK (kind IN ('sale_upfront', 'kept_change', 'customer_payment', 'supplier_payment',
                    'supplier_settlement', 'supplier_refund', 'expense', 'refund', 'other'));

ALTER TABLE treasury_ledger
  DROP CONSTRAINT treasury_ledger_kind_check,
  ADD CONSTRAINT treasury_ledger_kind_check
    CHECK (kind IN ('opening_float', 'shift_close', 'deposit', 'withdrawal', 'expense',
                    'customer_payment', 'supplier_payment', 'supplier_refund', 'adjustment', 'reversal'));

ALTER TABLE sale_payment_corrections
  ADD COLUMN after_close boolean NOT NULL DEFAULT false;

ALTER TABLE product_units
  ADD COLUMN purchase_cost numeric CHECK (purchase_cost IS NULL OR purchase_cost >= 0);
