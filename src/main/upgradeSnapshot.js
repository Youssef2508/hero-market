// Verified snapshot of the local database before a schema upgrade (no Electron imports, so tests can
// use it directly).
//
// When a new version of the app finds migrations that the store's database has not yet applied, it
// stops PostgreSQL cleanly, copies the whole data folder, verifies every file by SHA-256, writes a
// manifest, and only then lets the migrations run. If any step fails, nothing is migrated and the
// app reports the problem. Restoring = closing the app and putting the snapshot's pgdata folder back
// (with the previous app version) – see .docs/INSTALLATION_GUIDE.md.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const KEEP = 3

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, base, out)
    else if (e.isFile()) out.push(path.relative(base, full))
  }
  return out
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// Streamed, so a copy of a whole store (hundreds of MB) never blocks the app's main process: the
// window and its "preparing data" screen keep responding while the copy runs (1.4.0: a synchronous
// copy froze the start-up for 17 s on 157 MB).
const sha256Async = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })

/** Pending migration versions (applied: versions in schema_migrations; all: shipped versions). */
export function pendingVersions(applied, all) {
  const done = new Set(applied)
  return all.filter((v) => !done.has(v))
}

/** Is a snapshot needed? Only for an existing store database with something left to migrate. */
export function needsSnapshot(applied, all) {
  return applied.length > 0 && pendingVersions(applied, all).length > 0
}

/**
 * Copy a PostgreSQL data folder (server stopped) to `to` and verify every file by SHA-256, empty
 * directories included (pg_tblspc, pg_notify… matter to PostgreSQL). The lock files of a running
 * server are not copied. Returns { files: {rel: sha256}, directories, bytes }. Throws on any
 * difference. Used for pre-upgrade snapshots and for moving a store to the shared folder (1.4.0).
 */
export async function copyAndVerify(from, to) {
  if (!fs.existsSync(path.join(from, 'PG_VERSION')))
    throw new Error(`No PostgreSQL data folder at ${from}`)
  fs.mkdirSync(to, { recursive: true })
  const files = walk(from).filter((f) => !/^postmaster\.(pid|opts)$/.test(path.basename(f)))
  const out = { files: {}, directories: [], bytes: 0 }
  for (const rel of files) {
    const src = path.join(from, rel)
    const dst = path.join(to, rel)
    await fs.promises.mkdir(path.dirname(dst), { recursive: true })
    await fs.promises.copyFile(src, dst)
    const [a, b] = await Promise.all([sha256Async(src), sha256Async(dst)])
    if (a !== b) throw new Error(`Copy verification failed for ${rel}`)
    out.files[rel] = a
    out.bytes += (await fs.promises.stat(dst)).size
  }
  const walkDirs = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }))
      if (e.isDirectory()) {
        out.directories.push(path.relative(from, path.join(d, e.name)))
        walkDirs(path.join(d, e.name))
      }
  }
  walkDirs(from)
  for (const d of out.directories) fs.mkdirSync(path.join(to, d), { recursive: true })
  return out
}

/**
 * Copy `dataDir` (PostgreSQL stopped) into `<backupsDir>/<stamp>-<label>/pgdata`, verify every file
 * by SHA-256 and write manifest.json. Returns the snapshot folder. Throws on any difference.
 */
export async function snapshotDataDir(dataDir, backupsDir, label, now = new Date()) {
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION')))
    throw new Error(`No PostgreSQL data folder at ${dataDir}`)
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupsDir, `${stamp}-${label.replace(/[^\w.-]/g, '_')}`)
  const copied = await copyAndVerify(dataDir, path.join(target, 'pgdata'))
  const manifest = {
    createdAt: now.toISOString(),
    label,
    source: dataDir,
    files: copied.files,
    bytes: copied.bytes,
    directories: copied.directories,
    fileCount: Object.keys(copied.files).length
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return target
}

/** Re-check a snapshot against its manifest (used by tests and support). */
export function verifySnapshot(target) {
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'))
  const copy = path.join(target, 'pgdata')
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const f = path.join(copy, rel)
    if (!fs.existsSync(f) || sha256(f) !== hash) return { ok: false, file: rel }
  }
  return { ok: true, files: Object.keys(manifest.files).length }
}

/**
 * The copy --restore-pre-install puts back. `names` are the copies, oldest first; `versionOf` gives
 * a copy's data version. `which` is a copy's folder name, or a version (e.g. "1.4.0") for the newest
 * copy of that version's data; without it, the newest copy of the installed version's data. Going
 * back to an older version: restore its data with the newer program first, then run the older
 * installer (an older installer prunes copies by its own, older rule).
 */
export function pickRestoreCopy(names, versionOf, which, appVersion) {
  if (which && names.includes(which)) return which
  const version = which || appVersion
  return [...names].reverse().find((n) => versionOf(n) === version) || null
}

/**
 * Keep the newest `keep` snapshots (folder names start with an ISO timestamp). With `versionOf`
 * (a snapshot's name → the version its data belongs to), the newest snapshot of each of the last
 * `keep` data versions is kept too, so going back after a database update stays possible however
 * many times an installer runs afterwards (1.5.0 Sandbox check: four later runs had removed the
 * only copy of the 1.4.0 data).
 */
export function pruneSnapshots(backupsDir, keep = KEEP, versionOf = null) {
  if (!fs.existsSync(backupsDir)) return []
  const all = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(backupsDir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()
  const kept = new Set(all.slice(-keep))
  if (versionOf) {
    const versions = []
    for (const name of [...all].reverse()) {
      const v = versionOf(name)
      if (!v || versions.includes(v)) continue
      if (versions.length === keep) break
      versions.push(v)
      kept.add(name)
    }
  }
  const removed = all.filter((name) => !kept.has(name))
  for (const name of removed)
    fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true })
  return removed
}
