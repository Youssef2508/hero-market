-- 0015 – Manual fixed-amount invoice discount (owner decision 2026-10-21, D-057).
--
-- A user holding the permission pos.manual_discount may deduct a fixed EGP amount from the
-- current invoice, with a reason – e.g. a yogurt pack whose EGP 2 promotion was missed at
-- receiving. It never changes the product's price or stock. Automatic rules (D-044, 0006) are
-- unchanged and apply first; the manual amount applies to what is left, before customer credit.
--
-- Storage (schema only; no existing row changes):
--   - the amount is spread over the invoice's lines like the automatic cart discount and kept in
--     each line's cart_discount (the invoice-level share), so line nets, returns and profit stay
--     exactly as computed today;
--   - sales.manual_discount holds the invoice's manual total, for reports and shift figures;
--   - sale_discounts keeps a 'manual' row with who applied it, why and when.

ALTER TABLE sales
  ADD COLUMN manual_discount numeric NOT NULL DEFAULT 0 CHECK (manual_discount >= 0);

ALTER TABLE sale_discounts
  ADD COLUMN user_id    integer REFERENCES users(id),
  ADD COLUMN reason     text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 200),
  ADD COLUMN created_at timestamp;

CREATE INDEX idx_sales_manual_discount ON sales (shift_id) WHERE manual_discount > 0;
