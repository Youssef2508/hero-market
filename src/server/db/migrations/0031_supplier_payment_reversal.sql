-- 0031 – A rejected or cancelled supplier debt-payment request is reversed in full (owner, 1.5.2,
-- D-100; replaces the dispute and settlement of D-090). Schema only.
--
--   rejected  – an administrator rejected it;
--   cancelled – the cashier who recorded it cancelled it.
--   Either way the cash goes back: into the request's own shift drawer while that shift is open
--   (an inflow of kind supplier_payment_reversal), otherwise into the treasury, recorded against
--   that shift and request (treasury kind supplier_payment_reversal). The supplier's balance never
--   changed, so it is not touched. Nothing is an expense or a loss. The request and both money
--   movements stay on record.
--   The former 'disputed' and 'settled' states stay valid for any record that already has them;
--   nothing creates them any more.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE supplier_payment_requests
  ADD COLUMN reversed_by          integer REFERENCES users(id),
  ADD COLUMN reversed_at          timestamp,
  ADD COLUMN reversal_reason      text CHECK (reversal_reason IS NULL OR length(reversal_reason) <= 300),
  ADD COLUMN reversed_to          text CHECK (reversed_to IS NULL OR reversed_to IN ('shift', 'treasury')),
  ADD COLUMN reversal_ledger_id   integer REFERENCES safe_ledger(id),
  ADD COLUMN reversal_treasury_id integer REFERENCES treasury_ledger(id);

ALTER TABLE supplier_payment_requests
  DROP CONSTRAINT supplier_payment_requests_status_check,
  ADD CONSTRAINT supplier_payment_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'disputed', 'settled')),
  DROP CONSTRAINT supplier_payment_requests_check,
  ADD CONSTRAINT supplier_payment_requests_state_check CHECK (
    (status = 'pending' AND decided_at IS NULL AND settlement IS NULL AND reversed_at IS NULL)
    OR (status = 'approved' AND decided_at IS NOT NULL AND settlement IS NULL AND reversed_at IS NULL)
    OR (status IN ('rejected', 'cancelled') AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
        AND ((reversed_to = 'shift' AND reversal_ledger_id IS NOT NULL AND reversal_treasury_id IS NULL)
          OR (reversed_to = 'treasury' AND reversal_treasury_id IS NOT NULL AND reversal_ledger_id IS NULL)))
    OR (status = 'disputed' AND decided_at IS NOT NULL AND settlement IS NULL)
    OR (status = 'settled' AND decided_at IS NOT NULL AND settlement IS NOT NULL AND settled_at IS NOT NULL));

-- The money that goes back is never counted twice.
CREATE UNIQUE INDEX supplier_payment_requests_one_reversal_ledger
  ON supplier_payment_requests (reversal_ledger_id) WHERE reversal_ledger_id IS NOT NULL;
CREATE UNIQUE INDEX supplier_payment_requests_one_reversal_treasury
  ON supplier_payment_requests (reversal_treasury_id) WHERE reversal_treasury_id IS NOT NULL;

ALTER TABLE safe_ledger
  DROP CONSTRAINT safe_ledger_kind_check,
  ADD CONSTRAINT safe_ledger_kind_check
    CHECK (kind IN ('sale_upfront', 'kept_change', 'customer_payment', 'supplier_payment',
                    'supplier_settlement', 'supplier_payment_request', 'supplier_payment_reversal',
                    'supplier_refund', 'expense', 'refund', 'other'));

ALTER TABLE treasury_ledger
  DROP CONSTRAINT treasury_ledger_kind_check,
  ADD CONSTRAINT treasury_ledger_kind_check
    CHECK (kind IN ('opening_float', 'shift_close', 'deposit', 'withdrawal', 'expense',
                    'customer_payment', 'supplier_payment', 'supplier_refund',
                    'supplier_payment_reversal', 'adjustment', 'reversal'));
