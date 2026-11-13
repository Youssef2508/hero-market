-- 0037 – Customer codes follow the store's own series, and every form shows the code before saving
-- (owner, 1.6.1, D-107). No stored code changes.
--
--   * The automatic code is the next number of the store's series: C00012 is followed by C00013,
--     whatever the customer's internal number. (Before: C + the internal number, which on the cloud
--     working alone gave codes such as C1000000001.)
--   * A number once given is never given again, also after its customer was deleted: the series
--     keeps its highest number (client_code_series), starting above every code and every internal
--     number used so far (the former rule gave C + the internal number).
--   * The cloud, when it adds a customer on its own while the shop is unreachable, uses its own
--     series W00001, W00002, … – like the W- invoices – so the shop and the cloud can never give the
--     same code at the same time.
--   * hm_next_client_code() gives that code; the forms show it as the suggestion, and the same
--     function gives it when the customer is saved without a code typed by hand. A code typed by
--     hand still needs «تحديد كود العميل يدوياً», and stays unique ignoring case.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

-- Per database, not synchronised: the shop keeps the C series, the cloud its own W series.
CREATE TABLE client_code_series (
  prefix text PRIMARY KEY CHECK (prefix IN ('C', 'W')),
  last   bigint NOT NULL
);

INSERT INTO client_code_series (prefix, last)
SELECT 'C', GREATEST(
  COALESCE((SELECT MAX(substring(code FROM '^C([0-9]+)$')::bigint) FROM clients
             WHERE code ~ '^C[0-9]+$' AND length(code) <= 10), 0),
  COALESCE((SELECT MAX(id) FROM clients WHERE id < 1000000000), 0),
  -- Deleted customers had C + their number too: the counter of numbers given so far.
  -- (last_value is empty while the counter was never used.)
  COALESCE((SELECT last_value FROM pg_sequences
             WHERE schemaname = 'public' AND sequencename = 'clients_id_seq'
               AND last_value < 1000000000), 0)
)
UNION ALL
SELECT 'W', COALESCE((SELECT MAX(substring(code FROM '^W([0-9]+)$')::bigint) FROM clients
                        WHERE code ~ '^W[0-9]+$' AND length(code) <= 10), 0);

-- want: the series to give from. Empty: the database's own – W on a cloud copy
-- (sync_state.id_floor > 0 only there, migration 0033), C at the shop. The website asks for C while
-- the shop is connected, since the shop is the one that saves the customer then.
CREATE FUNCTION hm_next_client_code(want text DEFAULT NULL) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  series text := COALESCE(want, CASE WHEN COALESCE((SELECT id_floor FROM sync_state), 0) > 0 THEN 'W' ELSE 'C' END);
  n bigint;
  candidate text;
BEGIN
  -- After the highest number given in the series, and after any code of the series typed by hand.
  SELECT GREATEST(
           COALESCE((SELECT last FROM client_code_series s WHERE s.prefix = series), 0),
           COALESCE((SELECT MAX(substring(code FROM '^' || series || '([0-9]+)$')::bigint) FROM clients
                      WHERE code ~ ('^' || series || '[0-9]+$') AND length(code) <= 10), 0)
         ) + 1
    INTO n;
  LOOP
    candidate := series || lpad(n::text, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM clients WHERE upper(code) = upper(candidate));
    n := n + 1;
  END LOOP;
  RETURN candidate;
END $$;

CREATE OR REPLACE FUNCTION hm_client_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.code := OLD.code; -- a code is never removed, only replaced
      RETURN NEW;
    END IF;
    -- Two terminals adding customers at the same moment take the next numbers one after the other.
    PERFORM pg_advisory_xact_lock(hashtext('hm_next_client_code'));
    NEW.code := hm_next_client_code();
    UPDATE client_code_series SET last = GREATEST(last, substring(NEW.code FROM 2)::bigint)
     WHERE prefix = left(NEW.code, 1);
  END IF;
  RETURN NEW;
END $$;
