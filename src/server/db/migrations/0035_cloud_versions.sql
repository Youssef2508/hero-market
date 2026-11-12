-- 0035 – The cloud's versions, as last seen by the shop (Phase 2 milestone 5, architecture §14.1,
-- D-105). The cloud names its application and database versions on every answer; whoever holds the
-- link writes them here, so the sync screen shows both sides and «تحديث مطلوب» while the database
-- versions differ. Nothing else changes.
ALTER TABLE sync_state
  ADD COLUMN cloud_app_version text,
  ADD COLUMN cloud_schema      text;
