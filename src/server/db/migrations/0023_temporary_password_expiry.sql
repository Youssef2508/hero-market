-- 0023 – A temporary password expires (USER-02, owner feedback, D-076). Schema only.
--
-- When an administrator (or the local reset command) gives a user a temporary password, it works
-- for 72 hours; after that the user must ask for a new reset. Choosing one's own password clears it.
-- Existing users: NULL (no temporary password pending, or one given before this version: it keeps
-- working until it is changed, as before).
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

ALTER TABLE users ADD COLUMN temp_password_expires_at timestamp;
