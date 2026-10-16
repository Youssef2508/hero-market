-- 0014 – Measurement kinds the owner can add (1.4.0, owner decision 2026-10-16).
--
-- A product's base unit is measured in one kind (0005). Until now there were three fixed kinds:
-- count (whole pieces), weight (kilograms, 3 decimals) and volume (litres, 3 decimals). The owner
-- may now add his own, for example "بالمتر": a name, the unit shown on receipts and how many
-- decimals a quantity may have (0 = whole numbers only, up to 3). The three built-in kinds stay as
-- they are; weighing (scale labels, the weight window) remains specific to 'weight'.
--
-- A kind is stopped (is_active = false) rather than deleted while products use it, so a product
-- never loses its kind. Its decimals can only be raised while products use it (lowering could make
-- existing stock or unit factors invalid).
--
-- No existing row changes: every product keeps its kind, and the three built-in kinds get the
-- same rules they had.

CREATE TABLE measure_kinds (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  unit        text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  decimals    smallint NOT NULL CHECK (decimals BETWEEN 0 AND 3),
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0),
  updated_at  timestamp
);
CREATE UNIQUE INDEX measure_kinds_name_key ON measure_kinds (lower(btrim(name)));
CREATE SEQUENCE measure_kinds_custom_seq;

INSERT INTO measure_kinds (key, name, unit, decimals, is_system, sort_order) VALUES
  ('count',  'بالعدد', 'قطعة', 0, true, 1),
  ('weight', 'بالوزن', 'كجم',  3, true, 2),
  ('volume', 'بالحجم', 'لتر',  3, true, 3);

-- The fixed list (0005's CHECK) becomes a reference to the table.
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con
            WHERE con.conrelid = 'products'::regclass AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) LIKE '%unit_kind%' LOOP
    EXECUTE format('ALTER TABLE products DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE products
  ADD CONSTRAINT products_unit_kind_fkey FOREIGN KEY (unit_kind) REFERENCES measure_kinds (key);

INSERT INTO sync_tables (table_name, key_column) VALUES ('measure_kinds', 'key');
CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON measure_kinds
  FOR EACH ROW EXECUTE FUNCTION hm_sync_capture('key');

-- The till's browsing cache shows the unit, so a changed kind is a catalogue change.
CREATE TRIGGER bump_catalog AFTER INSERT OR DELETE OR UPDATE ON measure_kinds
  FOR EACH STATEMENT EXECUTE FUNCTION hm_bump_catalog();
