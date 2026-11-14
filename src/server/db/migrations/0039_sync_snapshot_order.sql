-- 0039 – A first full send lists each record after the records it points to (1.6.3, D-109).
--
-- hm_sync_snapshot() queued the synchronised tables alphabetically: product_barcodes and
-- product_units before products, sale_items before sales… The cloud applies a batch in several
-- passes, so a row that points to one later in the same batch still lands. But a full send of a
-- real store is many batches (4,000 rows each, agent.js): a package could arrive a whole batch
-- before its product, fail its reference, and be skipped by the cloud while the shop counted it as
-- delivered. Measured: a store of 3,000 products with 1,500 packages paired, and the cloud's copy
-- held no package and no package barcode; the comparison of the two sides (made from what the
-- cloud received, not from its tables) did not notice.
--
-- Now the tables are listed parents first, by their foreign keys (deepest reference last), and
-- alphabetically among equals. Changes made one by one were never affected: a record is always
-- written, and queued, after the records it points to. No stored row changes.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

-- The synchronised tables in an order where every table comes after the tables it references.
CREATE FUNCTION hm_sync_table_order() RETURNS TABLE (table_name text, key_column text, depth int)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE fk AS (
    SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
     WHERE c.contype = 'f' AND c.conrelid <> c.confrelid
  ), d (t, depth) AS (
    SELECT s.table_name, 0 FROM sync_tables s
    UNION ALL
    SELECT fk.child, d.depth + 1
      FROM d JOIN fk ON fk.parent = d.t
      JOIN sync_tables s ON s.table_name = fk.child
     WHERE d.depth < 40
  )
  SELECT s.table_name, s.key_column, max(d.depth)::int
    FROM sync_tables s JOIN d ON d.t = s.table_name
   GROUP BY s.table_name, s.key_column
   ORDER BY 3, 1
$$;

CREATE OR REPLACE FUNCTION hm_sync_snapshot(only_table text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  t record;
  n bigint := 0;
  c bigint;
BEGIN
  FOR t IN SELECT o.table_name, o.key_column FROM hm_sync_table_order() o
            WHERE only_table IS NULL OR o.table_name = only_table ORDER BY o.depth, o.table_name LOOP
    EXECUTE format(
      'SELECT count(hm_sync_enqueue(%L, hm_sync_key(%L, to_jsonb(x)), ''upsert'', to_jsonb(x))) FROM %I x',
      t.table_name, t.key_column, t.table_name)
    INTO c;
    n := n + c;
  END LOOP;
  RETURN n;
END $$;
