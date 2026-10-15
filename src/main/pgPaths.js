// Path rules for the bundled PostgreSQL tools (no Electron imports, so tests can use it directly).
//
// initdb / pg_ctl / postgres receive their own location and their arguments in the Windows ANSI code
// page. A path with characters outside it – e.g. a per-user install under C:\Users\محمد\… – arrives
// as "????" and the tools fail ("program postgres is needed by initdb but was not found"). Such
// paths are replaced by ASCII-only ones: the binaries are copied once to a cache folder.
import crypto from 'crypto'
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

// Plain recursive copy. fs.cpSync is avoided on purpose: on Node 22 for Windows its native
// implementation aborts the process (0xC0000409) for source paths with non-ASCII characters –
// exactly the paths this module exists for.
export function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

/**
 * Return a directory the PostgreSQL tools can run from. `pgsqlRoot` holds bin/, lib/ and share/.
 * When its path is not tool-safe, the tree is copied to `cacheRoot` (once per `stamp`, see
 * pgsqlStamp) and that copy is returned. A marker file is written last, so an interrupted copy is
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
    copyTree(pgsqlRoot, target)
    fs.writeFileSync(marker, `${pgsqlRoot}\n`)
  }
  return target
}

/**
 * Copy key for runnablePgsqlRoot: the app version plus a hash of the server binary, so a release
 * that ships different PostgreSQL binaries never reuses an older copy, even if the version number
 * was not raised. Reads the binary (about 10 MB): call it only when a copy is needed.
 */
export function pgsqlStamp(pgsqlRoot, appVersion) {
  const exe = ['postgres.exe', 'postgres']
    .map((f) => path.join(pgsqlRoot, 'bin', f))
    .find((f) => fs.existsSync(f))
  const digest = exe
    ? crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex').slice(0, 12)
    : 'nobin'
  return `${appVersion}-${digest}`
}
