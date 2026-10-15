-- Customers can have up to two phone numbers (owner, 2026-10-15): the existing primary number and an
-- optional second one. Two columns, not a separate table: the limit is part of the schema itself,
-- and searches, receipts, backups and synchronisation keep working on one row per customer.
-- Existing customers and their numbers are kept exactly as they are.

ALTER TABLE clients ADD COLUMN phone2 text;

ALTER TABLE clients
  ADD CONSTRAINT clients_phone2_needs_phone CHECK (phone2 IS NULL OR phone IS NOT NULL),
  ADD CONSTRAINT clients_phone2_differs CHECK (phone2 IS NULL OR phone2 <> phone);

CREATE UNIQUE INDEX clients_phone2_key ON clients(phone2) WHERE phone2 IS NOT NULL;

-- A number belongs to one customer, whichever slot it is in (phone is already unique on its own).
CREATE FUNCTION hm_client_phones_unique() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clients c
     WHERE c.id <> NEW.id
       AND ((NEW.phone IS NOT NULL AND c.phone2 = NEW.phone)
         OR (NEW.phone2 IS NOT NULL AND (c.phone = NEW.phone2 OR c.phone2 = NEW.phone2)))
  ) THEN
    RAISE EXCEPTION 'رقم الهاتف هذا مسجل لعميل آخر بالفعل!' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clients_phones_unique BEFORE INSERT OR UPDATE OF phone, phone2 ON clients
  FOR EACH ROW EXECUTE FUNCTION hm_client_phones_unique();
