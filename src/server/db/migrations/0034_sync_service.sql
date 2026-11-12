-- 0034 – The background synchronisation service (Phase 2 milestone 4, D-104).
-- Whoever holds the link to the cloud (the Windows background service, or the desktop program
-- while no service runs) writes its heartbeat here, so the screens can say whether the shop is
-- connected with the program closed, and since when. Nothing else changes.
ALTER TABLE sync_state
  ADD COLUMN agent_kind      text,        -- 'service' | 'desktop' | 'server'
  ADD COLUMN agent_pid       integer,
  ADD COLUMN agent_version   text,
  ADD COLUMN agent_started_at timestamp,
  ADD COLUMN agent_seen_at   timestamp;  -- last heartbeat (every 30 seconds while running)
