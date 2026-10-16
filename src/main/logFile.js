// The program's log file, which must never stop the program (1.4.0 release checks).
//
// On the owner's laptop the installer's failed setup (run as administrator) had created
// logs\app.log; the program, running with the user's normal rights, then could not open it, and the
// unhandled stream error ended in "A JavaScript error occurred in the main process". Now the first
// writable candidate is used (the shared logs folder, then the user's own folder), every write is
// guarded, and nothing here ever throws. (No Electron imports: tests use this module directly.)
import fs from 'fs'
import { dirname } from 'path'

const DAY = 24 * 60 * 60 * 1000

/**
 * Open the first candidate that can be appended to. Returns { path, write(line) }; path is null when
 * none could be opened (then writes are ignored). A log older than `maxAgeMs` starts afresh.
 */
export function openLogFile(candidates, { maxAgeMs = DAY, now = Date.now } = {}) {
  for (const file of candidates) {
    if (!file) continue
    try {
      fs.mkdirSync(dirname(file), { recursive: true })
      let flags = 'a'
      try {
        if (now() - fs.statSync(file).mtimeMs > maxAgeMs) flags = 'w'
      } catch {
        /* no log yet */
      }
      const fd = fs.openSync(file, flags) // throws now (EPERM, EACCES…), not later
      if (!fs.fstatSync(fd).isFile()) {
        // Windows lets a folder be "opened" for appending; writing would fail later.
        fs.closeSync(fd)
        continue
      }
      if (flags === 'w')
        fs.writeSync(
          fd,
          `[LOG ENGINE] [${new Date(now()).toISOString()}] Log file reset (older than a day).\n`
        )
      let broken = false
      return {
        path: file,
        write(line) {
          if (broken) return
          try {
            fs.writeSync(fd, line)
          } catch {
            broken = true // a full disk or a removed file never stops the program
          }
        }
      }
    } catch {
      /* try the next candidate */
    }
  }
  return { path: null, write() {} }
}
