-- 0005 – The cloud's record of the shop's rows no longer keeps the super administrator's recovery
-- code hash (D-106): the shop stops sending it, and what was received before is removed here.
UPDATE cloud_rows SET row_data = row_data - 'recovery_hash'
 WHERE table_name = 'users' AND row_data ? 'recovery_hash';
