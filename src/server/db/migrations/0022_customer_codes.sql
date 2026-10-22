-- 0022 – Customer codes (CUST-01, owner feedback, D-072). Schema + data.
--
--   * Every customer has a stable unique code, C + its number with at least five digits (C00012).
--     The number is the customer's id: ids are never reused, so a code is never recycled after a
--     deletion, and concurrent creation cannot collide (the id comes from the identity sequence).
--   * A code never changes once given (refused by a trigger).
--   * Each sale keeps the code of its customer (sales.client_code), so old invoices show it even
--     if the customer is later deleted.
--   * Backfill: existing customers get C + their id; existing sales get their customer's code.
--     No other value changes.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE clients ADD COLUMN code text;
UPDATE clients SET code = 'C' || lpad(id::text, 5, '0') WHERE code IS NULL;
ALTER TABLE clients
  ALTER COLUMN code SET NOT NULL,
  ADD CONSTRAINT clients_code_unique UNIQUE (code),
  ADD CONSTRAINT clients_code_format CHECK (code ~ '^C[0-9]{5,}$');

CREATE FUNCTION hm_client_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.code IS NULL THEN
      NEW.code := 'C' || lpad(NEW.id::text, 5, '0');
    END IF;
  ELSIF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'كود العميل لا يتغير بعد إنشائه.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hm_client_code BEFORE INSERT OR UPDATE OF code ON clients
  FOR EACH ROW EXECUTE FUNCTION hm_client_code();

ALTER TABLE sales ADD COLUMN client_code text;
-- Closed shifts' sales are protected from changes; the backfill is a one-time data load.
SELECT set_config('hm.bulk_load', 'on', true);
UPDATE sales s SET client_code = c.code FROM clients c WHERE c.id = s.client_id AND s.client_code IS NULL;
SELECT set_config('hm.bulk_load', 'off', true);
