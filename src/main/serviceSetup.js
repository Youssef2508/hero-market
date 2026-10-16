// Installer setup of the store's database as a Windows service (1.4.0, security review option C;
// .docs/SECURITY_REVIEW_LOCAL_DATABASE.md). Run by the per-machine installer, elevated:
//   HeroMarket-POS.exe --setup-service    install or upgrade
//   HeroMarket-POS.exe --stop-service     before program files are replaced (update)
//   HeroMarket-POS.exe --remove-service   uninstall (the data is kept)
//
// After setup:
// - PostgreSQL runs as the service <serviceName> under its own virtual account
//   NT SERVICE\<serviceName>, starts with Windows, listens on 127.0.0.1 only.
// - Only SYSTEM, Administrators and that account can open the database files. Windows users can
//   read the store folder (and heromarket.json) and write only its logs and backups.
// - The app connects as the ordinary role hm_app, owner of the shop's objects but not a superuser
//   (src/server/db/appRole.js). The superuser password is kept in admin\superuser.json, readable by
//   administrators only.
// - An existing database is first copied and verified file by file (backups\pre-install), then
//   converted: nothing is deleted.
import { app } from 'electron'
import { execFile } from 'child_process'
import { createRequire } from 'module'
import { join } from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import pg from 'pg'
import { storeDir, serviceName, perUserConfigFile } from './userDataPath'
import { runPgTool, choosePort, toolError, DB_NAME } from './localDatabase'
import { copyAndVerify, snapshotDataDir, pruneSnapshots, verifySnapshot } from './upgradeSnapshot'
import { systemTool } from './winTools'

const APP_ROLE = 'hm_app'
const NEW_SUPERUSER = 'hm_admin'
const SID = { system: '*S-1-5-18', admins: '*S-1-5-32-544', users: '*S-1-5-32-545' }

const paths = () => {
  const base = storeDir()
  return {
    base,
    data: join(base, 'pgdata'),
    logs: join(base, 'logs'),
    backups: join(base, 'backups'),
    admin: join(base, 'admin'),
    config: join(base, 'heromarket.json'),
    superuser: join(base, 'admin', 'superuser.json')
  }
}

let logFile = null
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`
  try {
    if (logFile) fs.appendFileSync(logFile, line)
  } catch {
    /* logging must never stop the setup */
  }
}

function exec(cmd, args) {
  return new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) =>
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        out: `${stdout}${stderr}`
      })
    )
  )
}

async function icacls(target, ...args) {
  const r = await exec(systemTool('icacls.exe'), [target, ...args, '/C', '/Q'])
  if (r.code !== 0) throw new Error(`icacls ${target} ${args.join(' ')}: ${r.out.trim()}`)
}

/** SID of the account running the setup (icacls accepts *SID, never a misread name). */
async function currentUserSid() {
  const r = await exec(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'])
  const m = /"(S-1-[0-9-]+)"/.exec(r.out)
  if (!m) throw new Error(`could not read the current user's SID: ${r.out.trim()}`)
  return m[1]
}

async function serviceState(name) {
  const r = await exec(systemTool('sc.exe'), ['query', name])
  if (/1060/.test(r.out) || r.code === 1060) return 'missing'
  const m = /STATE\s*:\s*\d+\s+(\w+)/.exec(r.out)
  return m ? m[1] : 'unknown'
}

async function waitState(name, wanted, seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    if ((await serviceState(name)) === wanted) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function stopService(name) {
  const state = await serviceState(name)
  if (state === 'missing' || state === 'STOPPED') return
  await exec(systemTool('sc.exe'), ['stop', name])
  if (!(await waitState(name, 'STOPPED', 90))) throw new Error(`service ${name} did not stop`)
}

/** A server started by a Windows user (1.4.0 test builds before this setup): stop it cleanly. */
async function stopUserStartedServer(data) {
  if (!fs.existsSync(join(data, 'postmaster.pid'))) return
  const st = await runPgTool('pg_ctl', ['status', '-D', data])
  if (st.code === 0) {
    log('stopping a database server started by a Windows user')
    const r = await runPgTool('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '90'])
    if (r.code !== 0) throw toolError('pg_ctl stop failed', r)
  }
}

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
const secret = () => crypto.randomBytes(24).toString('base64url')

function writeJson(file, value) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
  fs.renameSync(tmp, file)
}

async function connect(port, user, password, database) {
  const c = new pg.Client({
    host: '127.0.0.1',
    port,
    user,
    password,
    database,
    connectionTimeoutMillis: 3000,
    application_name: 'heromarket-setup'
  })
  c.on('error', () => {})
  await c.connect()
  return c
}

async function waitReachable(port, user, password) {
  for (let i = 0; i < 90; i++) {
    try {
      const c = await connect(port, user, password, 'postgres')
      await c.end()
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error('the database service did not accept connections')
}

/** Lock the store folder down: users read, write logs and backups only; the service owns pgdata. */
async function secureFolders(p, account) {
  for (const d of [p.base, p.logs, p.backups, p.admin]) fs.mkdirSync(d, { recursive: true })
  // Each locked folder: first /reset (drops every explicit rule: the "Users: modify" of earlier
  // 1.4.0 test builds, the installing user's temporary grant for initdb), then exactly its rules.
  for (const d of [p.base, p.data, p.admin]) await icacls(d, '/reset')
  // Whole folder: no inherited "Users may create files" rule, explicit read for users.
  await icacls(
    p.base,
    '/inheritance:r',
    '/grant:r',
    `${SID.system}:(OI)(CI)F`,
    `${SID.admins}:(OI)(CI)F`,
    `${SID.users}:(OI)(CI)RX`
  )
  // Everything below inherits from it again (removes the "Users: modify" rights of earlier 1.4.0
  // test builds and of files created by their owners).
  // Database files and the superuser password first: their own rules, nothing inherited.
  await icacls(
    p.data,
    '/inheritance:r',
    '/grant:r',
    `${SID.system}:(OI)(CI)F`,
    `${SID.admins}:(OI)(CI)F`,
    `${account}:(OI)(CI)M`
  )
  await icacls(
    p.admin,
    '/inheritance:r',
    '/grant:r',
    `${SID.system}:(OI)(CI)F`,
    `${SID.admins}:(OI)(CI)F`
  )
  for (const d of [p.data, p.admin]) {
    for (const e of fs.readdirSync(d)) await icacls(join(d, e), '/reset', '/T')
  }
  for (const e of fs.readdirSync(p.base)) {
    if (e === 'pgdata' || e === 'admin') continue
    await icacls(join(p.base, e), '/reset', '/T')
  }
  await icacls(p.base, '/grant', `${account}:(OI)(CI)RX`)
  // Logs and backups: the app (any Windows user) writes its log, import copies and restore copies.
  await icacls(p.logs, '/grant', `${SID.users}:(OI)(CI)M`)
  await icacls(p.backups, '/grant', `${SID.users}:(OI)(CI)M`)
}

/** A store kept in this Windows user's profile before 1.4.0: copied (verified) into the store folder. */
async function adoptPerUserStore(p) {
  const old = perUserConfigFile()
  if (!old || !fs.existsSync(old)) return null
  const cfg = readJson(old)
  if (!cfg || !cfg.local || !cfg.local.dir) return null
  const from = join(cfg.local.dir, 'pgdata')
  if (!fs.existsSync(join(from, 'PG_VERSION'))) return null
  if (fs.existsSync(join(p.data, 'PG_VERSION'))) return null // the shared store wins; nothing moved
  log('copying the per-user store from', from)
  const partial = `${p.data}.partial`
  fs.rmSync(partial, { recursive: true, force: true })
  await copyAndVerify(from, partial)
  if (fs.existsSync(p.data)) fs.rmdirSync(p.data)
  fs.renameSync(partial, p.data)
  fs.renameSync(old, `${old}.moved-to-${p.base.replace(/[\\/:]/g, '_')}`)
  return cfg
}

export async function setupService() {
  const p = paths()
  const name = serviceName()
  const account = `NT SERVICE\\${name}`
  fs.mkdirSync(p.logs, { recursive: true })
  logFile = join(p.logs, 'setup.log')
  log(`setup ${app.getVersion()} service=${name} store=${p.base} user=${os.userInfo().username}`)

  await stopService(name)
  await stopUserStartedServer(p.data)

  let cfg = readJson(p.config)
  if (!cfg) {
    const adopted = await adoptPerUserStore(p)
    if (adopted) cfg = { ...adopted, local: { ...adopted.local, dir: p.base } }
  }
  const hasCluster = fs.existsSync(join(p.data, 'PG_VERSION'))
  if (cfg && cfg.local && cfg.local.password && !hasCluster && cfg.local.initialised !== false) {
    throw new Error(`the store's database is missing from ${p.data}; nothing was created`)
  }

  // 1. A verified copy of an existing database before anything changes (the newest 3 are kept).
  //    It records which version the data belongs to, for a later rollback (--restore-pre-install).
  const fromVersion = cfg?.local?.setupVersion || (hasCluster ? 'before-1.4.0-service' : null)
  let snap = null
  if (hasCluster) {
    const dir = join(p.backups, 'pre-install')
    snap = await snapshotDataDir(p.data, dir, `app-${app.getVersion()}`)
    fs.writeFileSync(
      join(snap, 'update.json'),
      JSON.stringify(
        { fromVersion, toVersion: app.getVersion(), at: new Date().toISOString() },
        null,
        2
      )
    )
    pruneSnapshots(dir)
    log('verified copy of the database:', snap)
  }

  // 2. Credentials: superuser (administrators only) and the app role (readable by users).
  const prevSuper = readJson(p.superuser)
  let superuser
  let port
  let converting = false // an older database whose superuser password Windows users could read
  if (!hasCluster) {
    port = await choosePort(54330)
    superuser = { user: NEW_SUPERUSER, password: secret() }
    fs.mkdirSync(p.admin, { recursive: true })
    await icacls(
      p.admin,
      '/inheritance:r',
      '/grant:r',
      `${SID.system}:(OI)(CI)F`,
      `${SID.admins}:(OI)(CI)F`
    )
    writeJson(p.superuser, superuser) // before initdb: a rerun can complete an interrupted setup
    // initdb drops the Administrators group from its own token (PostgreSQL never runs with
    // administrator rights), so it reads the password from this user's private temp folder and may
    // write the empty data folder through this user's account. secureFolders() removes that grant.
    const tmp = fs.mkdtempSync(join(os.tmpdir(), 'hm-setup-'))
    const pw = join(tmp, 'pw')
    fs.writeFileSync(pw, superuser.password)
    fs.mkdirSync(p.data, { recursive: true })
    await icacls(p.data, '/grant', `*${await currentUserSid()}:(OI)(CI)F`)
    try {
      log('creating the database cluster')
      const r = await runPgTool('initdb', [
        '-D',
        p.data,
        '-U',
        superuser.user,
        `--pwfile=${pw}`,
        '-E',
        'UTF8',
        '--locale=C',
        '--auth-host=scram-sha-256',
        '--auth-local=scram-sha-256'
      ])
      if (r.code !== 0) throw toolError('initdb failed', r)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  } else if (prevSuper && cfg?.local?.service) {
    superuser = prevSuper // already converted (an update): unchanged
    port = cfg.local.port
  } else if (cfg?.local?.password) {
    // Created before the service (the app role was the cluster's superuser): that password is
    // known to every Windows user, so it is replaced below and kept for administrators only.
    superuser = { user: cfg.local.user || 'heromarket', password: cfg.local.password }
    port = cfg.local.port
    converting = true
  } else {
    throw new Error(
      `a database exists in ${p.data} but its credentials are missing; nothing was changed`
    )
  }

  // 3. The service: own virtual account, automatic start, 127.0.0.1 only. Re-registered on every
  //    install so it always runs the binaries of this version.
  if ((await serviceState(name)) !== 'missing') {
    const r = await runPgTool('pg_ctl', ['unregister', '-N', name])
    log('unregistered previous service:', r.code)
  }
  const reg = await runPgTool('pg_ctl', [
    'register',
    '-N',
    name,
    '-D',
    p.data,
    '-S',
    'auto',
    '-w',
    '-o',
    `-p ${port} -c listen_addresses=127.0.0.1 -c logging_collector=on`
  ])
  if (reg.code !== 0) throw toolError('pg_ctl register failed', reg)
  // Its own virtual account (no password; created by Windows with the service).
  const acct = await exec(systemTool('sc.exe'), ['config', name, 'obj=', account])
  if (acct.code !== 0) throw new Error(`could not set the service account: ${acct.out.trim()}`)
  // Windows users may start the service (the app does when it is stopped); only administrators may
  // stop, change or delete it.
  const sddl =
    'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPLOCRRC;;;BU)(A;;CCLCSWLOCRRC;;;IU)'
  log('service permissions:', (await exec(systemTool('sc.exe'), ['sdset', name, sddl])).out.trim())
  await exec(systemTool('sc.exe'), [
    'failure',
    name,
    'reset=',
    '86400',
    'actions=',
    'restart/5000/restart/10000/restart/60000'
  ])
  await exec(systemTool('sc.exe'), [
    'description',
    name,
    'HeroMarket POS – قاعدة بيانات المتجر (127.0.0.1 فقط)'
  ])

  // 4. Folder permissions, then start.
  await secureFolders(p, account)
  const started = await exec(systemTool('sc.exe'), ['start', name])
  if (!(await waitState(name, 'RUNNING', 90)))
    throw new Error(`service ${name} did not start: ${started.out.trim()}`)
  await waitReachable(port, superuser.user, superuser.password)

  // 5. Roles and ownership.
  const { ensureAppRole, transferOwnership, foreignOwned } = server(join('db', 'appRole.js'))
  const appPassword =
    cfg?.local?.service && cfg.local.user === APP_ROLE ? cfg.local.password : secret()
  let c = await connect(port, superuser.user, superuser.password, 'postgres')
  try {
    await ensureAppRole(c, { role: APP_ROLE, password: appPassword })
    const exists = (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]))
      .rowCount
    if (!exists) {
      await c.query(
        `CREATE DATABASE ${DB_NAME} OWNER ${APP_ROLE} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
      )
    }
  } finally {
    await c.end()
  }
  c = await connect(port, superuser.user, superuser.password, DB_NAME)
  try {
    const moved = await transferOwnership(c, {
      database: DB_NAME,
      from: superuser.user,
      to: APP_ROLE
    })
    const left = await foreignOwned(c, APP_ROLE)
    if (left.length) throw new Error(`objects not owned by the app role: ${left.join(', ')}`)
    log(`ownership: ${moved} object(s) moved to ${APP_ROLE}`)
    if (converting) {
      // Its old password was in heromarket.json, readable by every Windows user: a new one, kept
      // for administrators only.
      superuser = { user: superuser.user, password: secret() }
      await c.query(`ALTER ROLE "${superuser.user}" PASSWORD '${superuser.password}'`)
      log('superuser password replaced')
    }
  } finally {
    await c.end()
  }
  writeJson(p.superuser, superuser)

  const writeConfig = (setupVersion) =>
    writeJson(p.config, {
      mode: 'local',
      terminalName: cfg?.terminalName || os.hostname(),
      secret: cfg?.secret || crypto.randomBytes(32).toString('base64url'),
      local: {
        dir: p.base,
        port,
        user: APP_ROLE,
        password: appPassword,
        service: name,
        initialised: true,
        setupVersion
      }
    })

  // 6. The database itself: Case A (nothing to migrate) or Case B (migrations, checked; any loss
  //    or damage puts the verified copy back). Done here, right after the copy, never by the
  //    program on start (.docs/UPDATE_GUIDE.md).
  const result = await updateDatabase({ p, port, appPassword, snap, account, name })
  history(p, {
    fromVersion,
    toVersion: app.getVersion(),
    case: result.case,
    pending: result.pending,
    snapshot: snap,
    result: result.ok ? 'ok' : 'restored',
    problems: result.problems
  })
  if (!result.ok) {
    // The data is back as it was; the new program refuses to open it until the setup succeeds.
    writeConfig(fromVersion && fromVersion !== 'before-1.4.0-service' ? fromVersion : '0')
    const e = new Error(
      `update of the database failed and the verified copy was put back: ${result.problems.join('; ')}`
    )
    e.code = 'migration_failed'
    throw e
  }

  // 7. The app's configuration (readable by Windows users: no superuser credentials in it).
  writeConfig(app.getVersion())
  log('setup complete')
}

/** Case A/B of an update, in the installer (elevated), right after the verified copy. */
async function updateDatabase({ p, port, appPassword, snap, account, name }) {
  const { schemaState, dataFingerprint, compareFingerprints, integrityProblems, assertNotNewer } =
    server(join('db', 'upgrade.js'))
  const { migrate } = server(join('db', 'migrate.js'))
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: APP_ROLE,
    password: appPassword,
    database: DB_NAME,
    max: 2,
    application_name: 'heromarket-setup'
  })
  pool.on('error', () => {})
  let state
  let failure = null
  let problems = []
  try {
    const c = await pool.connect()
    try {
      state = await schemaState(c)
      assertNotNewer(state) // a newer version's database: refuse, change nothing
    } finally {
      c.release()
    }
    if (state.case === 'A') {
      log(`Case A: no database change (schema ${state.applied.at(-1) || 'none'})`)
      return { ok: true, case: 'A', pending: [], problems: [] }
    }
    log(`Case B: migrations to apply: ${state.pending.join(', ')}`)
    const c1 = await pool.connect()
    let before
    let damagedBefore
    try {
      before = await dataFingerprint(c1)
      damagedBefore = new Set(await integrityProblems(c1))
    } finally {
      c1.release()
    }
    try {
      await migrate(pool, { logger: { info: (m) => log(m) } })
      const c2 = await pool.connect()
      try {
        const after = await dataFingerprint(c2)
        // Records kept, and no NEW inconsistency (an old one must not block every update).
        problems = [
          ...compareFingerprints(before, after),
          ...(await integrityProblems(c2)).filter((x) => !damagedBefore.has(x))
        ]
      } finally {
        c2.release()
      }
    } catch (e) {
      failure = e
    }
  } catch (e) {
    await pool.end().catch(() => {})
    throw e // refused before any change (e.g. database_newer)
  }
  await pool.end().catch(() => {})
  if (!failure && !problems.length) {
    log(`Case B done: ${state.pending.length} migration(s) applied; records and stock checked`)
    return { ok: true, case: 'B', pending: state.pending, problems: [] }
  }
  if (failure) problems.unshift(`migration failed: ${failure.message}`)
  log('Case B FAILED:', problems.join('; '))
  if (!snap) {
    // A new database (nothing to restore): the error stands, nothing of the shop's data existed.
    return { ok: false, case: 'B', pending: state.pending, problems }
  }
  await putBack(p, snap, account, name, 'failed')
  log('verified copy put back:', snap)
  return { ok: false, case: 'B', pending: state.pending, problems }
}

/** Replace pgdata by a verified copy; the replaced folder is kept beside it as evidence. */
async function putBack(p, snap, account, name, why) {
  const check = verifySnapshot(snap)
  if (!check.ok) throw new Error(`the copy ${snap} does not match its manifest (${check.file})`)
  await stopService(name)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.renameSync(p.data, `${p.data}.${why}-${stamp}`)
  const partial = `${p.data}.partial`
  fs.rmSync(partial, { recursive: true, force: true })
  await copyAndVerify(join(snap, 'pgdata'), partial)
  fs.renameSync(partial, p.data)
  await secureFolders(p, account)
  await exec(systemTool('sc.exe'), ['start', name])
  if (!(await waitState(name, 'RUNNING', 90))) throw new Error(`service ${name} did not start`)
}

function history(p, entry) {
  try {
    fs.appendFileSync(
      join(p.logs, 'update-history.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'
    )
  } catch {
    /* the history must never stop the setup */
  }
}

/**
 * Support command (elevated): HeroMarket-POS.exe --restore-pre-install[=<folder name>]
 * Puts back the newest (or the named) verified copy taken before an installation or update, e.g.
 * when a problem is found after an update. Sales made after that copy are NOT in it: export a
 * backup first. Then install the version the copy belongs to (update.json: fromVersion).
 */
export async function restorePreInstall(which) {
  const p = paths()
  const name = serviceName()
  fs.mkdirSync(p.logs, { recursive: true })
  logFile = join(p.logs, 'setup.log')
  const dir = join(p.backups, 'pre-install')
  const all = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((n) => fs.existsSync(join(dir, n, 'manifest.json')))
        .sort()
    : []
  const versionOf = (n) => (readJson(join(dir, n, 'update.json')) || {}).fromVersion || null
  // Default: the newest copy whose data belongs to the version installed now (an attempt to install
  // an older version over newer data also takes a copy, of that newer data, which is not wanted).
  const pick = which
    ? all.find((n) => n === which)
    : [...all].reverse().find((n) => versionOf(n) === app.getVersion())
  if (!pick) {
    const list = all.map((n) => `${n} (data of ${versionOf(n) || 'unknown'})`).join(', ')
    throw new Error(
      `no verified copy ${which || `with data of version ${app.getVersion()}`} in ${dir}. Copies: ${list || 'none'}. Name one with --restore-pre-install=<name>.`
    )
  }
  const snap = join(dir, pick)
  const info = readJson(join(snap, 'update.json')) || {}
  log(`restore-pre-install ${pick} (data of version ${info.fromVersion || 'unknown'})`)
  await putBack(p, snap, `NT SERVICE\\${name}`, name, 'replaced')
  const cfg = readJson(p.config)
  if (cfg?.local) {
    cfg.local.setupVersion = info.fromVersion || '0'
    writeJson(p.config, cfg)
  }
  history(p, { restoreOf: pick, dataVersion: info.fromVersion || null, result: 'restored' })
  log('restore complete: install version', info.fromVersion || '(the version of that copy)', 'next')
}

export async function stopServiceOnly() {
  const name = serviceName()
  await stopService(name)
}

export async function removeService() {
  const name = serviceName()
  await stopService(name)
  if ((await serviceState(name)) !== 'missing')
    await runPgTool('pg_ctl', ['unregister', '-N', name])
}

// The server code is CommonJS under the app's src/server folder (as in backend.js).
const nodeRequire = createRequire(import.meta.url)
const server = (rel) => nodeRequire(join(app.getAppPath(), 'src', 'server', rel))
