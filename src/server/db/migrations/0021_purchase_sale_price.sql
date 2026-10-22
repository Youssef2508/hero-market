-- 0021 – A new selling price entered on a purchase line (owner, 2026-10-22, D-068). Schema only;
-- no stored value changes.
--
-- When the owner fills "سعر البيع الجديد" or "سعر البيع الجديد (الجملة)" for a line, confirming the
-- purchase sets the product's selling or wholesale price (of its base unit) to it, in the same
-- transaction; an empty field changes nothing. The line keeps each price it set and the one it
-- replaced, so the purchase shows what it changed. Package prices are never changed by a purchase.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE supplier_purchase_items
  ADD COLUMN new_retail_price    numeric CHECK (new_retail_price IS NULL OR new_retail_price >= 0),
  ADD COLUMN old_retail_price    numeric,
  ADD COLUMN new_wholesale_price numeric CHECK (new_wholesale_price IS NULL OR new_wholesale_price >= 0),
  ADD COLUMN old_wholesale_price numeric;
