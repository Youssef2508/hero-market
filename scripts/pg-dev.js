// Local development PostgreSQL (no installer, no Docker): runs PostgreSQL 17 from the
// `embedded-postgres` dev dependency with its data in ./.pgdata (git-ignored).
//
//   npm run pg:dev            start (creates the cluster on first run) and keep running; Ctrl+C stops it
//   npm run pg:dev -- url     print the connection URL for the development database
//   npm run pg:dev -- url heromarket_test
//   npm run pg:dev -- stop    stop the server (Windows; it runs detached under pg_ctl)
//
// Listens on 127.0.0.1:54329 only. A random password is generated on first run and kept in
// .pgdata/credentials.json. Never use this for a real store – see .docs/DATABASE_ARCHITECTURE.md.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const base = path.join(root, '.pgdata')
const dataDir = path.join(base, 'data')
const credFile = path.join(base, 'credentials.json')
const PORT = Number(process.env.HEROMARKET_PG_DEV_PORT || 54329)
const DATABASES = ['heromarket', 'heromarket_test']

function credentials() {
  if (!fs.existsSync(credFile)) {
    fs.mkdirSync(base, { recursive: true })
    const cred = {
      user: 'heromarket_dev',
      password: crypto.randomBytes(18).toString('base64url'),
      port: PORT
    }
    fs.writeFileSync(credFile, JSON.stringify(cred, null, 2), { mode: 0o600 })
  }
  return JSON.parse(fs.readFileSync(credFile, 'utf8'))
}

function url(db = 'heromarket') {
  const c = credentials()
  return `postgres://${c.user}:${encodeURIComponent(c.password)}@127.0.0.1:${c.port}/${db}`
}

async function start() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const c = credentials()
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: c.port,
    user: c.user,
    password: c.password,
    persistent: true,
    // Byte-order collation = the ordering SQLite used (BINARY), UTF-8 for Arabic text.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
    onError: (e) => console.error('[pg-dev]', String(e).trim())
  })
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log('[pg-dev] creating cluster in', dataDir)
    await pg.initialise()
  }
  // Windows: start through pg_ctl, which drops administrator rights (postgres.exe refuses to run
  // elevated, e.g. on CI runners). The server keeps running if this script is killed; `stop` ends it.
  const win = process.platform === 'win32' ? await import('@embedded-postgres/windows-x64') : null
  // The started server inherits pg_ctl's handles, so `start` must not capture output (it would never
  // finish); its errors go to .pgdata/postgres.log.
  const ctl = (args, stdio = 'pipe') =>
    spawnSync(win.pg_ctl, args, { encoding: 'utf8', windowsHide: true, stdio })
  if (win) {
    if (ctl(['status', '-D', dataDir]).status !== 0) {
      const res = ctl(
        [
          'start',
          '-D',
          dataDir,
          '-w',
          '-t',
          '90',
          '-l',
          path.join(base, 'postgres.log'),
          '-o',
          `-p ${c.port} -c listen_addresses=127.0.0.1`
        ],
        'ignore'
      )
      if (res.status !== 0) throw new Error('pg_ctl start failed, see .pgdata/postgres.log')
    }
  } else {
    await pg.start()
  }
  const client = pg.getPgClient('postgres', '127.0.0.1')
  await client.connect()
  for (const db of DATABASES) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])
    if (!rowCount) {
      await client.query(
        `CREATE DATABASE ${db} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`
      )
      console.log('[pg-dev] created database', db)
    }
  }
  await client.end()
  console.log(`[pg-dev] PostgreSQL ready on 127.0.0.1:${c.port}`)
  for (const db of DATABASES)
    console.log(`[pg-dev]   ${db}: ${url(db).replace(/:[^:@/]+@/, ':****@')}`)
  console.log('[pg-dev] full URL: npm run pg:dev -- url')
  const shutdown = async () => {
    console.log('[pg-dev] stopping…')
    if (win) ctl(['stop', '-D', dataDir, '-m', 'fast', '-w'])
    else await pg.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  setInterval(() => {}, 1 << 30) // stay alive
}

if (require.main === module) {
  if (process.argv[2] === 'url') {
    console.log(url(process.argv[3]))
  } else if (process.argv[2] === 'stop') {
    import('@embedded-postgres/windows-x64')
      .then(({ pg_ctl }) =>
        spawnSync(pg_ctl, ['stop', '-D', dataDir, '-m', 'fast', '-w'], { stdio: 'inherit' })
      )
      .catch((e) => console.error('[pg-dev]', e.message))
  } else {
    start().catch((e) => {
      console.error('[pg-dev] failed:', e && e.message ? e.message : e)
      process.exit(1)
    })
  }
}

module.exports = { url }
