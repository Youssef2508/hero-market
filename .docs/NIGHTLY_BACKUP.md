# Nightly backup

Written for the owner's support person and the developer. It describes the automatic backup approved by the owner on 2026-10-21 (D-060, BACKUP-01): what it does, where the copies are, how to restore one and how a failure shows.

## What it does

- **When:** every day at **12:00 AM local time**, with no confirmation and no window. It runs even when nobody is signed in to Windows, and while the till is open.
- **Missed midnight:** if the PC was off at midnight, one copy is taken as soon as it starts again. If the database service is still starting then, the run waits for it (up to 10 minutes) instead of failing for the day. Never more than one a day: a second run the same day does nothing.
- **One run at a time:** the nightly and after-close runs never write together. A run that finds the other one busy (a shift closed just before midnight) waits for it, up to 20 minutes, then makes its own copy (D-080).
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

## After each shift close (D-074, owner 2026-10-22)

- When a shift is closed, the till starts a second task, «HeroMarket Backup After Close», without asking anyone and without waiting. The old question «هل تريد أخذ نسخة احتياطية…» is removed.
- The task has no schedule. It runs the same job as the system account, so the copy goes into the same locked folder, with the same checks: read back completely, SHA-256 written next to it, never overwritten.
- Windows users may start this task, but not change or delete it, and they still cannot delete a copy.
- Each close writes `HeroMarket-close-YYYY-MM-DD_HHMMSS.json.gz`. The newest 20 are kept; daily and weekly copies are not affected.
- Its last result is in `logs\backup-close-status.json` and `logs\backup.log`.

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

A copy restores only into the same HeroMarket database version: a 1.5.0 copy into 1.5.0, a file saved by 1.4.0 only into 1.4.0. The program refuses any other with a message.

To check a copy without touching the shop, restore it on another PC or into a test install (`tests/service/scheduledBackup.test.js` does this automatically into a disposable database).

## Failure reporting

- **Failed run:** `backup.log` has a line starting with `backup: FAILED`, with the reason (for example, the database service was not running).
- **On screen:** the النسخ الاحتياطي screen shows the time of the last good copy and the failed attempt.
- **Task not registered:** if the installer could not register the task, `setup.log` has `WARNING nightly backup task not registered`, and running the installer again retries.

## Earlier evidence (test builds, 2026-10-21 and 2026-10-22)

| Check                                                                                                                                                                                                                                                                          | Result   | Where                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------- |
| Naming, once a day, missed-midnight catch-up, weekly copy, retention 14 + 8 over 70 days, newest never removed                                                                                                                                                                 | Pass     | `tests/unit/backupJob.test.mjs`                                           |
| A failed export or a copy that does not verify changes nothing; no file overwritten; leftovers removed                                                                                                                                                                         | Pass     | same                                                                      |
| Task definition: midnight daily, system account, catch-up, one instance                                                                                                                                                                                                        | Pass     | same                                                                      |
| Copy restores row for row into a separate disposable database                                                                                                                                                                                                                  | Pass     | `tests/service/scheduledBackup.test.js`                                   |
| Consistent snapshot: a sale during the backup is either entirely in the copy or not at all; no line without its invoice                                                                                                                                                        | Pass     | same                                                                      |
| Performance on the development PC: about 80,000 rows in 1.6 s, 0.4 MB; a sale while it ran took 0.25 s                                                                                                                                                                         | Measured | same                                                                      |
| Installer registers the task (00:00 daily, system account, catch-up, one instance) and the folder (users read-only)                                                                                                                                                            | Pass     | Windows Sandbox, test build 1.5.0-test.1 (SHA-256 `ee83242f…`), script B1 |
| Run with the program closed: daily and weekly copies, read back (38 tables), SHA-256 matches, run as SYSTEM                                                                                                                                                                    | Pass     | Sandbox B2                                                                |
| A normal Windows user can read the copies but deleting them is refused ("Access is denied")                                                                                                                                                                                    | Pass     | Sandbox B2                                                                |
| A second run the same day does nothing                                                                                                                                                                                                                                         | Pass     | Sandbox B3                                                                |
| Missed midnight: after the clock moved past 00:00 the scheduler ran the missed backup by itself, once (also after a 6-day jump: one copy, not six); the weekly copy only in a new ISO week; the program open meanwhile                                                         | Pass     | Sandbox B4                                                                |
| Uninstall removes the task and keeps the copies                                                                                                                                                                                                                                | Pass     | Sandbox B5                                                                |
| After-close task (C1): registered by the installer (on demand, system account); started twice with normal user rights it wrote two verified close copies (SHA-256) into the locked folder, run as SYSTEM; deleting a copy as a normal user refused; the nightly task unchanged | Pass     | Windows Sandbox, test build 1.5.0-test.2 (SHA-256 `2ef5685f…`), script C1 |

## Evidence on the final 1.5.0 installer (2026-10-22)

Windows Sandbox: a clean, disposable Windows 10. The starting point was the shop's own 1.4.0 build (the visit stick, SHA-256 `960bc572…`) over 1.3 with a copy of the 1.3 data, plus sample money records. Then the final `HeroMarket-Setup-1.5.0.exe` (SHA-256 `9f8e506c…`). The Sandbox clock was moved to reach midnights; its time synchronisation was stopped so the moved clock held. Nothing was started by hand unless the table says so.

| Check                                                                                                                                                                                                                                                                                                    | Result |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The update from 1.4.0 registers both tasks: nightly at 00:00 daily, system account, catch-up, one instance, `--scheduled-backup`; after-close with no schedule, system account, `--scheduled-backup --after-close`. Folder: users read and run only                                                      | Pass   |
| Nightly run with the program closed (started by hand once): a daily and a weekly copy, each read back (41 tables, schema 0023), SHA-256 equal to its `.sha256` file, run as SYSTEM                                                                                                                       | Pass   |
| A normal Windows user lists the copies; deleting one: "Access is denied", the copy stays                                                                                                                                                                                                                 | Pass   |
| After a shift close, started the way the till starts it (`schtasks /Run` by a normal user), twice: two verified close copies, run as SYSTEM                                                                                                                                                              | Pass   |
| **The 00:00 trigger by itself**, two nights in a row: Windows started the task at 00:00:01; `HeroMarket-daily-<date>_0000.json.gz` written; the oldest daily copy removed, 14 kept                                                                                                                       | Pass   |
| **PC off at midnight, database not yet running at the next start:** the clock jumped two days to 07:30 with the database service stopped; the scheduler started the missed run by itself; it waited ("waiting for the database"), the service started 40 s later, the copy was written 4 s after (D-080) | Pass   |
| **A shift closed at midnight:** the close copy and the nightly run started together; both copies written (D-080)                                                                                                                                                                                         | Pass   |
| The program open during a nightly run: copy written, program still running                                                                                                                                                                                                                               | Pass   |
| Retention over 18 days run by the scheduler (no day missed): exactly the newest 14 daily copies, the weekly copies of each ISO week (limit 8), the newest 20 of 22 close copies; every kept copy verifies                                                                                                | Pass   |
| **Restore:** four copies (two daily, two after-close) taken out of the Sandbox and restored with 1.5.0's own restore, each into a fresh disposable database on the development PC: every figure equal to the store's figures when the copy was made                                                      | Pass   |
| Earlier note: an earlier attempt without stopping the Sandbox's time synchronisation saw the clock set back within seconds; those runs logged "today's copy already exists" for the real date. Not a program fault; repeated as above                                                                    | —      |

## What only the shop PC can show

- Whether the PC is on, asleep or off at midnight, and how long its database service takes to start. The job covers all three: the copy is made at the next start and waits up to 10 minutes for the database.
- The time a copy takes on the shop's real data (on test data: about one second; on about 80,000 rows: 1.6 s).
- A disk that fills up or fails. The copies stay on the same PC: one copy a week goes to a USB stick.

## After installing 1.5.0: checking the first copies

This is the owner's check ([UPGRADE_TO_1.5.0.md](UPGRADE_TO_1.5.0.md) section E):

1. After the first shift close: `C:\ProgramData\HeroMarket\backups\scheduled` has a new `HeroMarket-close-<date>_<time>.json.gz` with its `.sha256` file, within a minute.
2. The next morning: `HeroMarket-daily-<date>_0000.json.gz` (or, if the PC was off at midnight, the time it was started), with its `.sha256` file.
3. «النسخ الاحتياطي» shows «آخر نسخة ناجحة» with last night's time.
4. If a copy is missing: `logs\backup.log` says why (`backup: FAILED …`). Until it is fixed, a copy by hand every evening («إنشاء نسخة احتياطية الآن»).
