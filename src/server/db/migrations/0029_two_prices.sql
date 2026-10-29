-- 0029 – Two prices per unit: purchase and selling (owner, 1.5.2, D-096). Schema only.
--
--   1. The wholesale price is no longer used: no screen, import, export, purchase line or command
--      reads or writes it. The columns (products.wholesale_price, product_units.wholesale_price,
--      supplier_purchase_items.new_/old_wholesale_price) are KEPT with their values, for history;
--      nothing is deleted.
--   2. product_units.retail_auto: how a package's selling price is set, stored explicitly.
--        true  – automatic: the piece's current selling price × the package's factor, always
--                (it follows every change of either);
--        false – typed by the owner: kept as typed until he restores the automatic price.
--      Existing packages: those with a price of their own keep it (typed, false); those without
--      one were already sold at piece price × factor and stay automatic (true). Nothing sold
--      changes price on the day of the update.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE product_units ADD COLUMN retail_auto boolean NOT NULL DEFAULT true;
UPDATE product_units SET retail_auto = (retail_price IS NULL);
-- An automatic package has no stored price of its own.
ALTER TABLE product_units
  ADD CONSTRAINT product_units_retail_mode CHECK (retail_auto OR retail_price IS NOT NULL);
