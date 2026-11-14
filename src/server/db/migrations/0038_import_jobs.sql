-- 0038 – Importing the store's Excel file as a background job (1.6.3, D-108).
--
-- Before: the screen sent the whole file in one request and waited for the answer. A large file
-- outlasted the waits on the way (a second till: 15 s; the website while the shop is connected:
-- 20 s, and the shop counted as unreachable after 40 s), and the screen took the missing answer
-- for "not imported" while the import went on. Now the file's rows are stored as a job and the
-- answer comes at once; the job is carried out here, in the background, and the screens follow it.
--
--   * import_jobs – one row per import: who, which file, its state and progress, the problems
--     found in the file, the counts written. Synchronised with the cloud (the website follows a job
--     the shop carries out, and the shop learns of one the cloud carried out on its own).
--   * import_job_data – the job's rows until it ends. Kept on the side that carries the job out
--     (not synchronised, not in backups): only that side ever works on it, and a job whose rows
--     are not here is never started here.
--
-- A job is written in one transaction, as the screen's import always was: all its rows or none.
-- So a job interrupted by a restart left nothing behind and is carried out again from the start;
-- a cancelled job wrote nothing. No existing row is changed.
--
-- Rollback: restore the verified copy taken by the installer before this migration (Case B).

CREATE TABLE import_jobs (
  id               uuid PRIMARY KEY,
  user_id          integer,
  username         text,
  terminal         text,
  filename         text NOT NULL DEFAULT '',
  content_hash     text NOT NULL,          -- sha256 of the rows: the same file twice is noticed
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  stage            text NOT NULL DEFAULT 'queued',
  total_rows       integer NOT NULL DEFAULT 0,
  processed_rows   integer NOT NULL DEFAULT 0, -- written so far in the running attempt (not saved yet)
  successful_rows  integer NOT NULL DEFAULT 0, -- saved: set only with the import's own commit
  failed_rows      integer NOT NULL DEFAULT 0, -- rows with a problem (nothing is written then)
  skipped_rows     integer NOT NULL DEFAULT 0,
  summary          jsonb,                      -- the counts per kind, as the check shows them
  errors           jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ sheet, row, field, message }]
  error_code       text,
  error_message    text,
  cancel_requested boolean NOT NULL DEFAULT false,
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamp NOT NULL DEFAULT LOCALTIMESTAMP(0),
  started_at       timestamp,
  heartbeat_at     timestamp,
  finished_at      timestamp
);
CREATE INDEX idx_import_jobs_created ON import_jobs (created_at DESC);
CREATE INDEX idx_import_jobs_open ON import_jobs (created_at) WHERE status IN ('queued', 'processing');

CREATE TABLE import_job_data (
  job_id    uuid PRIMARY KEY REFERENCES import_jobs (id) ON DELETE CASCADE,
  rows      jsonb NOT NULL,                 -- { products, customers, suppliers } as the screen read them
  -- Written in the job's own transaction, with its records: the job is saved. The job's row is
  -- marked completed just after (never inside that transaction: the job's row changes in the order
  -- the screens and the cloud see them); after a stop in between, the next runner only marks it.
  committed jsonb
);

INSERT INTO sync_tables (table_name, key_column) VALUES ('import_jobs', 'id');
CREATE TRIGGER zz_sync_capture AFTER INSERT OR UPDATE OR DELETE ON import_jobs
  FOR EACH ROW EXECUTE FUNCTION hm_sync_capture('id');
