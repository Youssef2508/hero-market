-- Recovery after a restore on the PC: rows newer than the backup's (epoch, version), in order.
CREATE INDEX cloud_rows_by_version ON cloud_rows (store_id, epoch, version);
