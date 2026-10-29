-- 0028 – Supplier debt-payment requests (owner, 1.5.2, D-090) and references on shift money
-- movements (D-091). Schema only.
--
--   1. safe_ledger gains what a movement refers to (ref_type, ref_id), who it was with (party:
--      the customer or supplier name, or a reference for an unnamed customer) and who recorded it
--      (user_id). Older rows keep NULL: their description already names them.
--   2. A new movement kind, supplier_payment_request: cash handed to a supplier from the drawer
--      for an older debt, waiting for an administrator. It is drawer money (it leaves the drawer at
--      once) but not yet a payment of the supplier's balance.
--   3. supplier_payment_requests: one row per request. pending → approved (the balance falls once),
--      or pending → disputed (rejected after the cash was handed) → settled by what really
--      happened: the money came back (returned), it was a valid payment after all (applied), or
--      it is lost (loss). The cash never moves a second time on approval.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE safe_ledger
  ADD COLUMN ref_type text CHECK (ref_type IS NULL OR length(ref_type) <= 40),
  ADD COLUMN ref_id integer,
  ADD COLUMN party text CHECK (party IS NULL OR length(party) <= 200),
  ADD COLUMN user_id integer REFERENCES users(id);

ALTER TABLE safe_ledger
  DROP CONSTRAINT safe_ledger_kind_check,
  ADD CONSTRAINT safe_ledger_kind_check
    CHECK (kind IN ('sale_upfront', 'kept_change', 'customer_payment', 'supplier_payment',
                    'supplier_settlement', 'supplier_payment_request', 'supplier_refund', 'expense',
                    'refund', 'other'));

ALTER TABLE treasury_ledger
  DROP CONSTRAINT treasury_ledger_ref_type_check,
  ADD CONSTRAINT treasury_ledger_ref_type_check
    CHECK (ref_type IS NULL OR ref_type IN ('shift', 'expense', 'client', 'supplier', 'supplier_purchase',
                                            'supplier_payment_request'));

CREATE TABLE supplier_payment_requests (
  id                  serial PRIMARY KEY,
  supplier_id         integer NOT NULL REFERENCES suppliers(id),
  amount              numeric(14, 2) NOT NULL CHECK (amount > 0),
  shift_id            integer NOT NULL REFERENCES shifts(id),
  ledger_id           integer REFERENCES safe_ledger(id),
  note                text CHECK (note IS NULL OR length(note) <= 300),
  created_by          integer NOT NULL REFERENCES users(id),
  created_at          timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0),
  client_ref          text NOT NULL UNIQUE CHECK (length(client_ref) BETWEEN 8 AND 120),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'disputed', 'settled')),
  decided_by          integer REFERENCES users(id),
  decided_at          timestamp,
  decision_note       text CHECK (decision_note IS NULL OR length(decision_note) <= 300),
  settlement          text CHECK (settlement IS NULL OR settlement IN ('returned', 'applied', 'loss')),
  settled_by          integer REFERENCES users(id),
  settled_at          timestamp,
  settlement_note     text CHECK (settlement_note IS NULL OR length(settlement_note) <= 300),
  settlement_ledger_id   integer REFERENCES safe_ledger(id),
  settlement_treasury_id integer REFERENCES treasury_ledger(id),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND settlement IS NULL)
    OR (status = 'approved' AND decided_at IS NOT NULL AND settlement IS NULL)
    OR (status = 'disputed' AND decided_at IS NOT NULL AND settlement IS NULL)
    OR (status = 'settled' AND decided_at IS NOT NULL AND settlement IS NOT NULL AND settled_at IS NOT NULL))
);

CREATE INDEX idx_supplier_payment_requests_status ON supplier_payment_requests (status, id);
CREATE INDEX idx_supplier_payment_requests_shift ON supplier_payment_requests (shift_id);
CREATE INDEX idx_safe_ledger_ref ON safe_ledger (ref_type, ref_id) WHERE ref_type IS NOT NULL;

-- Sent to the owner's cloud copy like the other supplier records.
INSERT INTO sync_tables (table_name, key_column) VALUES ('supplier_payment_requests', 'id');
CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON supplier_payment_requests
  FOR EACH ROW EXECUTE FUNCTION hm_sync_capture('id');
