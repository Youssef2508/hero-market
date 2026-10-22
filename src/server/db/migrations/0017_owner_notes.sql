-- 0017 – Owner notes after phase D (2026-10-21, D-063). Schema only; no stored value changes.
--
--   1. A product's barcode can be changed (PROD-01). Sale lines and damaged-goods rows follow the
--      product to its new barcode, as stock movements, units, extra barcodes, purchase lines and
--      discount rules already do (ON UPDATE CASCADE since 0004–0006).
--   2. A payment method correction needs no reason (the owner's request); one may still be given.
--   3. Each return records how much went back and by which payment method, so the shift details
--      show "مسترد نقداً" exactly. Older returns have neither (shown from their refund amount).
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE sale_items
  DROP CONSTRAINT sale_items_product_barcode_fkey,
  ADD CONSTRAINT sale_items_product_barcode_fkey FOREIGN KEY (product_barcode)
    REFERENCES products(barcode) ON UPDATE CASCADE;
ALTER TABLE damaged_goods
  DROP CONSTRAINT damaged_goods_product_barcode_fkey,
  ADD CONSTRAINT damaged_goods_product_barcode_fkey FOREIGN KEY (product_barcode)
    REFERENCES products(barcode) ON UPDATE CASCADE;

ALTER TABLE sale_payment_corrections
  ALTER COLUMN reason DROP NOT NULL,
  DROP CONSTRAINT sale_payment_corrections_reason_check,
  ADD CONSTRAINT sale_payment_corrections_reason_check
    CHECK (reason IS NULL OR length(reason) <= 300);

ALTER TABLE sale_returns
  ADD COLUMN refund_method text CHECK (refund_method IS NULL OR refund_method IN ('cash', 'visa', 'wallet', 'instapay')),
  ADD COLUMN paid_back     numeric(14, 2);
