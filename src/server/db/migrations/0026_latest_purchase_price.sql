-- 0026 – The latest purchase price replaces the moving average (owner, 1.5.2, D-087). Data + schema.
--
--   From 1.5.2 a product's purchase price (products.cost_price, per base unit) is the price of its
--   latest confirmed purchase, never an average. Sales keep the cost on their lines (snapshot);
--   returns move at the cost of the transaction they reverse.
--
--   1. Sale lines without a cost snapshot (NULL or 0). Until now the reports used the product's
--      current price for them (× the line's unit factor), so their profit moved with every new
--      purchase. They get that same value now, recorded in sale_item_cost_backfill: no reported
--      profit changes today, and later prices no longer reach old sales. Lines of products with no
--      price at all stay at 0, as the reports showed them.
--   2. Each product's purchase price becomes the price of its latest recorded purchase line, per
--      base unit (the line's cost ÷ its unit factor; the latest by purchase time, then purchase,
--      then line). Free lines (price 0: bonus goods) do not count, as at a purchase; a product
--      never bought (or only free) keeps its price. Every change is recorded in
--      product_cost_migration (old price, new price, the purchase and line it came from).
--      Package prices, selling prices, stock and every historical record are not changed.
--   3. supplier_purchases.client_ref: the request id of a purchase, so a retried confirmation is
--      recorded once.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

CREATE TABLE sale_item_cost_backfill (
  sale_item_id integer PRIMARY KEY REFERENCES sale_items(id) ON DELETE CASCADE,
  old_cost     numeric,
  cost         numeric NOT NULL CHECK (cost >= 0),
  recorded_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

CREATE TABLE product_cost_migration (
  id               serial PRIMARY KEY,
  barcode          text NOT NULL,
  old_cost         numeric,
  new_cost         numeric NOT NULL CHECK (new_cost >= 0),
  purchase_id      integer,
  purchase_item_id integer,
  recorded_at      timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0)
);

-- Closed shifts' sale lines are protected from changes; this is a one-time data load.
SELECT set_config('hm.bulk_load', 'on', true);

-- 1. Freeze the cost the reports used for lines without a snapshot.
INSERT INTO sale_item_cost_backfill (sale_item_id, old_cost, cost)
SELECT si.id, si.cost_price, round(p.cost_price * COALESCE(NULLIF(si.unit_factor, 0), 1), 4)
  FROM sale_items si JOIN products p ON p.barcode = si.product_barcode
 WHERE COALESCE(si.cost_price, 0) = 0 AND COALESCE(p.cost_price, 0) > 0;
UPDATE sale_items si SET cost_price = b.cost
  FROM sale_item_cost_backfill b WHERE b.sale_item_id = si.id;

-- 2. The latest purchase price of each product.
WITH latest AS (
  SELECT DISTINCT ON (i.product_barcode)
         i.product_barcode, i.id AS item_id, i.purchase_id,
         round(i.unit_cost / COALESCE(NULLIF(i.unit_factor, 0), 1), 4) AS cost
    FROM supplier_purchase_items i JOIN supplier_purchases sp ON sp.id = i.purchase_id
   WHERE i.unit_cost > 0
   ORDER BY i.product_barcode, sp.timestamp DESC NULLS LAST, sp.id DESC, i.id DESC
)
INSERT INTO product_cost_migration (barcode, old_cost, new_cost, purchase_id, purchase_item_id)
SELECT p.barcode, p.cost_price, l.cost, l.purchase_id, l.item_id
  FROM products p JOIN latest l ON l.product_barcode = p.barcode
 WHERE p.cost_price IS DISTINCT FROM l.cost;
UPDATE products p SET cost_price = m.new_cost
  FROM product_cost_migration m WHERE m.barcode = p.barcode;

SELECT set_config('hm.bulk_load', 'off', true);

-- 3. One request id per purchase.
ALTER TABLE supplier_purchases
  ADD COLUMN client_ref text UNIQUE CHECK (client_ref IS NULL OR length(client_ref) <= 120);
