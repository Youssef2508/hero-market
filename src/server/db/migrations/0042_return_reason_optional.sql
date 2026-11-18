-- 0042 – The reason of a return without an invoice is optional (owner, 1.9.1, D-116). An empty
-- reason is stored as NULL; a written one is kept as before.
ALTER TABLE customer_returns DROP CONSTRAINT IF EXISTS customer_returns_reason_check;
ALTER TABLE customer_returns ALTER COLUMN reason DROP NOT NULL;
