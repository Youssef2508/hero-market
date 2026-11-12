-- 0036 – Security review before the pilot (Phase 2 milestone 5, D-106).
--
-- 1. The super administrator's recovery code never reaches the cloud: the cloud refuses recovery
--    (it is done on the shop PC only), so it has no reason to hold even its hash. A cloud copy that
--    already holds them clears them, without sending anything back.
-- 2. A password changed or reset on one side ends that user's sessions on the other side when the
--    change arrives (a lost phone is signed out by changing the password at the shop). Only real
--    changes count – a new password (password_changed_at) or a reset (temp_password_expires_at) –
--    not the automatic renewal of a hash at sign-in (D-105).
CREATE OR REPLACE FUNCTION hm_sync_row(tbl text, r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE tbl
    WHEN 'users' THEN r - 'pin_lookup' - 'pin_hash' - 'password_hash' - 'recovery_hash'
    ELSE r
  END
$$;

DO $$
BEGIN
  IF (SELECT id_floor FROM sync_state) > 0 THEN
    PERFORM set_config('hm.sync_capture', 'off', true);
    UPDATE users SET recovery_hash = NULL WHERE recovery_hash IS NOT NULL;
  END IF;
END $$;

CREATE FUNCTION hm_end_sessions_on_credential_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only for what arrives from the other side (written while merging); a change made here ends
  -- the sessions itself, keeping the one that made it.
  IF COALESCE(current_setting('hm.ledger_rebuild', true), '') = 'on'
     AND (NEW.password_changed_at IS DISTINCT FROM OLD.password_changed_at
          OR NEW.temp_password_expires_at IS DISTINCT FROM OLD.temp_password_expires_at) THEN
    UPDATE sessions SET revoked_at = LOCALTIMESTAMP(0) WHERE user_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER users_end_sessions_on_credential_change
  AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION hm_end_sessions_on_credential_change();
