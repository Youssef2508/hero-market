// Path rules for the bundled PostgreSQL tools (no Electron imports, so tests can use it directly).
//
// initdb / pg_ctl / postgres receive their own location and their arguments in the Windows ANSI code
// page. A path with characters outside it – e.g. a per-user install under C:\Users\محمد\… – arrives
// as "????" and the tools fail ("program postgres is needed by initdb but was not found"). Such
// paths are replaced by ASCII-only ones: the binaries are copied once to a cache folder.
import fs from 'fs'
import path from 'path'

/** True when every character of the path is printable ASCII (safe for the PostgreSQL tools). */
export function isToolSafePath(p) {
  return /^[\x20-\x7e]*$/.test(String(p))
}

/** ASCII-only folder for HeroMarket files on this machine (ProgramData is ASCII on every Windows). */
export function asciiMachineDir(...parts) {
  const programData = process.env.ProgramData || 'C:\\ProgramData'
  return path.join(programData, 'HeroMarket', ...parts)
}

/**
 * Return a directory the PostgreSQL tools can run from. `pgsqlRoot` holds bin/, lib/ and share/.
 * When its path is not tool-safe, the tree is copied to `cacheRoot` (once per `stamp`, e.g. the
 * app version) and that copy is returned. A marker file is written last, so an interrupted copy is
 * redone on the next start instead of being used half-finished.
 */
export function runnablePgsqlRoot(pgsqlRoot, { cacheRoot, stamp }) {
  if (isToolSafePath(pgsqlRoot)) return pgsqlRoot
  if (!cacheRoot || !isToolSafePath(cacheRoot)) {
    throw new Error(`No ASCII-only folder available for the PostgreSQL tools (${cacheRoot})`)
  }
  const target = path.join(cacheRoot, `pgsql-${String(stamp).replace(/[^0-9A-Za-z._-]/g, '_')}`)
  const marker = path.join(target, '.complete')
  if (!fs.existsSync(marker)) {
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(pgsqlRoot, target, { recursive: true })
    fs.writeFileSync(marker, `${pgsqlRoot}\n`)
  }
  return target
}
