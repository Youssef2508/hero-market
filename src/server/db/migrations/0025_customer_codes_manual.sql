-- 0025 – Customer codes may be entered by hand (owner, 1.5.2, D-086). Schema only; no stored value
-- changes.
--
--   * Automatic stays the default: C + the customer's number with at least five digits (C00012).
--     If a code typed by hand already took that value, the next free one is used (C00012-1, -2…).
--   * A code typed by hand: 1–30 characters, no spaces around it and no control characters; any
--     letters, digits or signs otherwise (Arabic included).
--   * Unique ignoring upper and lower case (c00012 and C00012 are the same code), in the database,
--     so two terminals saving at once cannot both get it.
--   * A code may be changed later (the service allows it with its permission and logs it). Sales keep
--     the code they were made with (sales.client_code), so old invoices are unchanged.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE clients
  DROP CONSTRAINT clients_code_format,
  DROP CONSTRAINT clients_code_unique,
  ADD CONSTRAINT clients_code_format CHECK (
    length(code) BETWEEN 1 AND 30 AND code = btrim(code) AND code !~ '[[:cntrl:]]'
  );
CREATE UNIQUE INDEX clients_code_unique ON clients (upper(code));

CREATE OR REPLACE FUNCTION hm_client_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  base text;
  candidate text;
  n int := 0;
BEGIN
  IF NEW.code IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.code := OLD.code; -- a code is never removed, only replaced
      RETURN NEW;
    END IF;
    base := 'C' || lpad(NEW.id::text, 5, '0');
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM clients WHERE upper(code) = upper(candidate)) LOOP
      n := n + 1;
      candidate := base || '-' || n;
    END LOOP;
    NEW.code := candidate;
  END IF;
  RETURN NEW;
END $$;
