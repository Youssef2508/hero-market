# Nightly backup

Written for the owner's support person and the developer. It describes the automatic backup approved by the owner on 2026-10-21 (D-060, BACKUP-01): what it does, where the copies are, how to restore one and how a failure shows.

## What it does

- **When:** every day at **12:00 AM local time**, with no confirmation and no window. It runs even when nobody is signed in to Windows, and while the till is open.
- **Missed midnight:** if the PC was off at midnight, one copy is taken as soon as it starts again. Never more than one a day: a second run the same day does nothing.
- **How it is started:**
  - the Windows Task Scheduler task **`HeroMarket\HeroMarket Backup`** runs `HeroMarket-POS.exe --scheduled-backup` as the system account;
  - it is created by the installer and removed by the uninstaller;
  - task settings: start when available, ignore a second instance, stop after two hours, run on battery too.
- **What is copied:** the whole database, in the program's own backup format. It's the same format as "حفظ نسخة احتياطية" on the النسخ الاحتياطي screen, gzip-compressed.
  - All tables are read in one read-only snapshot, so a sale saved during the backup is either entirely in the copy or not in it at all.
  - Reading never blocks the till.
- **Why not `pg_dump`:** the PostgreSQL bundled with HeroMarket has no `pg_dump` or `pg_restore` (only `initdb`, `pg_ctl` and `postgres`). Adding them would mean shipping new binaries, which needs the owner's approval. The program's own format is restored by the program itself and has been tested since 1.4.0.

## Where the copies are

| What        | Where                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copies      | `%ProgramData%\HeroMarket\backups\scheduled`                                                                                                          |
| Permissions | The system account and administrators write; Windows users can only read (to restore or copy to a USB stick); nobody else can change or delete a copy |
| Log         | `%ProgramData%\HeroMarket\logs\backup.log` (no passwords, no customer data)                                                                           |
| Last result | `%ProgramData%\HeroMarket\logs\backup-status.json`, also shown on the النسخ الاحتياطي screen                                                          |

## Names and retention

- `HeroMarket-daily-2026-10-22_0000.json.gz`: the daily copy (local date and time).
- `HeroMarket-weekly-2026-10-22_0000.json.gz`: the first good copy of each ISO week.
- Each copy has a `.sha256` file next to it. A file without one is not treated as a backup.
- **Retention:** the newest **14 daily** and **8 weekly** copies.
- **Safety rules:**
  - a new copy is written as `.partial`, read back completely (format, schema, the shop's tables, the exact row counts written), hashed and only then renamed;
  - pruning happens only after that;
  - a copy is never written over an existing file, and the newest copy of each kind is never deleted;
  - a failed run leaves the existing copies untouched.

## Restore

1. Close the till. Open HeroMarket as the owner, then **النسخ الاحتياطي ← استعادة نسخة احتياطية**.
2. The file dialog opens in the nightly folder. Choose the copy (`.json.gz`).
3. Before anything is replaced, the program saves the current data to `backups\pre-restore-<time>.json`.
4. After the restore everyone signs in again.

To check a copy without touching the shop, restore it on another PC or into a test install (`tests/service/scheduledBackup.test.js` does this automatically into a disposable database).

## Failure reporting

- **Failed run:** `backup.log` has a line starting with `backup: FAILED`, with the reason (for example, the database service was not running).
- **On screen:** the النسخ الاحتياطي screen shows the time of the last good copy and the failed attempt.
- **Task not registered:** if the installer could not register the task, `setup.log` has `WARNING nightly backup task not registered`, and running the installer again retries.

## Evidence (2026-10-21)

| Check                                                                                                                                                  | Result          | Where                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ----------------------------------------------------------- |
| Naming, once a day, missed-midnight catch-up, weekly copy, retention 14 + 8 over 70 days, newest never removed                                         | Pass            | `tests/unit/backupJob.test.mjs`                             |
| A failed export or a copy that does not verify changes nothing; no file overwritten; leftovers removed                                                 | Pass            | same                                                        |
| Task definition: midnight daily, system account, catch-up, one instance                                                                                | Pass            | same                                                        |
| Copy restores row for row into a separate disposable database                                                                                          | Pass            | `tests/service/scheduledBackup.test.js`                     |
| Consistent snapshot: a sale during the backup is either entirely in the copy or not at all; no line without its invoice                                | Pass            | same                                                        |
| Performance on the development PC: about 80,000 rows in 1.6 s, 0.4 MB; a sale while it ran took 0.25 s                                                 | Measured        | same                                                        |
| **Task registration, a scheduled run with the program closed and nobody signed in, folder permissions, missed-run recovery on a real Windows install** | **Not yet run** | Needs an installed build: Windows Sandbox, then the shop PC |
