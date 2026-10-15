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
 * Copy `dataDir` (PostgreSQL stopped) into `<backupsDir>/<stamp>-<label>/pgdata`, verify every file
 * by SHA-256 and write manifest.json. Returns the snapshot folder. Throws on any difference.
 */
export function snapshotDataDir(dataDir, backupsDir, label, now = new Date()) {
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION')))
    throw new Error(`No PostgreSQL data folder at ${dataDir}`)
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupsDir, `${stamp}-${label.replace(/[^\w.-]/g, '_')}`)
  const copy = path.join(target, 'pgdata')
  fs.mkdirSync(copy, { recursive: true })
  const files = walk(dataDir).filter((f) => !/^postmaster\.(pid|opts)$/.test(path.basename(f)))
  const manifest = { createdAt: now.toISOString(), label, source: dataDir, files: {}, bytes: 0 }
  for (const rel of files) {
    const src = path.join(dataDir, rel)
    const dst = path.join(copy, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    const a = sha256(src)
    const b = sha256(dst)
    if (a !== b) throw new Error(`Snapshot verification failed for ${rel}`)
    manifest.files[rel] = a
    manifest.bytes += fs.statSync(dst).size
  }
  // Empty directories matter to PostgreSQL (pg_tblspc, pg_notify…): recreate them too.
  const dirs = []
  const walkDirs = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }))
      if (e.isDirectory()) {
        dirs.push(path.relative(dataDir, path.join(d, e.name)))
        walkDirs(path.join(d, e.name))
      }
  }
  walkDirs(dataDir)
  for (const d of dirs) fs.mkdirSync(path.join(copy, d), { recursive: true })
  manifest.directories = dirs
  manifest.fileCount = files.length
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

/** Keep the newest `keep` snapshots (folder names start with an ISO timestamp). */
export function pruneSnapshots(backupsDir, keep = KEEP) {
  if (!fs.existsSync(backupsDir)) return []
  const all = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(backupsDir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort()
  const removed = all.slice(0, Math.max(0, all.length - keep))
  for (const name of removed)
    fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true })
  return removed
}
