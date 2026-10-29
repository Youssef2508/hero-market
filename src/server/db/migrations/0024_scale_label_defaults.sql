-- 0024 – Scale-label defaults (owner, 1.5.2, D-084). Settings data only.
--
--   The defaults are now: label length 13, item code from offset 1 for 6 digits, weight/price
--   from offset 7 for 5 digits, weight ÷ 1000, price ÷ 100 (offsets counted from 0).
--   A store whose saved scale settings are still exactly the previous defaults (code from offset 2
--   for 5 digits) gets the new code positions. The code still ends at offset 7, so the label's
--   product code (2000001) and its weight read exactly as before. Anything the owner changed –
--   another length, other positions or divisors – is left as it is. A store with no saved scale
--   settings uses the new defaults from the program.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

DO $$
DECLARE
  current jsonb;
BEGIN
  BEGIN
    SELECT value::jsonb INTO current FROM settings WHERE key = 'scale_labels';
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN; -- not JSON: the program refuses it and shows the defaults; nothing to migrate
  END;
  IF current IS NULL THEN
    RETURN;
  END IF;
  IF current @> '{"length": 13, "codeStart": 2, "codeLength": 5, "valueStart": 7, "valueLength": 5, "weightDivisor": 1000, "priceDivisor": 100}'::jsonb THEN
    UPDATE settings
       SET value = (current || '{"codeStart": 1, "codeLength": 6}'::jsonb)::text
     WHERE key = 'scale_labels';
  END IF;
END $$;
