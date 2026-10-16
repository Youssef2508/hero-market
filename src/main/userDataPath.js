import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'

// Imported first by src/main/index.js so it runs before any module reads app.getPath('userData').
//
// HeroMarket keeps its data (local PostgreSQL cluster, configuration, backups, logs) in
// %APPDATA%\HeroMarket. HEROMARKET_USER_DATA points a session at another folder (QA of first-run
// and upgrade flows on a copy of a store's data, support diagnostics) without touching real data.
// Development and preview builds use their own folder, so they never open the installed store's data.
//
// A packaged build can name its own folders in package.json → "heromarket": { "dataDir",
// "legacyDir" } (set by electron-builder.qa.yml for the QA edition), so a test installation on a
// store's PC can never open or import the store's real data.
function packagedFolders() {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
    return pkg.heromarket || {}
  } catch {
    return {}
  }
}
const folders = app.isPackaged ? packagedFolders() : {}

app.setPath(
  'userData',
  process.env.HEROMARKET_USER_DATA ||
    join(
      app.getPath('appData'),
      app.isPackaged ? folders.dataDir || 'HeroMarket' : 'HeroMarket-dev'
    )
)

/**
 * The store's data: database cluster, heromarket.json (database password, server secret), backups
 * and logs. Version 1.4.0 installs per machine, so every Windows user of the cashier PC opens the
 * same store: the data lives in %ProgramData%\HeroMarket (always an ASCII path), not in one user's
 * profile. The window's own preferences (theme, last user name) stay per Windows user in userData.
 * Development and HEROMARKET_USER_DATA sessions keep everything in their own folder.
 */
export function storeDir() {
  if (process.env.HEROMARKET_USER_DATA || !app.isPackaged) return app.getPath('userData')
  const programData = process.env.ProgramData || 'C:\\ProgramData'
  return join(programData, folders.storeDir || 'HeroMarket')
}

/**
 * Is the store's database run by the Windows service the installer set up (1.4.0, security review
 * option C)? True for an installed app; development, tests and HEROMARKET_USER_DATA sessions keep an
 * app-managed database in their own folder.
 */
export function usesDatabaseService() {
  return process.platform === 'win32' && app.isPackaged && !process.env.HEROMARKET_USER_DATA
}

/** Name of the store's database service (also its virtual account NT SERVICE<name>). */
export function serviceName() {
  return folders.serviceName || 'HeroMarketDB'
}

/**
 * The store folder. For an installed app it is created and secured by the installer
 * (--setup-service, serviceSetup.js): Windows users may read it and write only its logs and
 * backups; the database files belong to the service account. Nothing here changes permissions.
 * (Until 1.4.0's security review, the first account to start HeroMarket granted every user modify
 * rights on the whole folder, database files included. That is removed.)
 */
export function ensureStoreDir() {
  const dir = storeDir()
  if (!usesDatabaseService()) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** heromarket.json of a pre-1.4.0 per-user installation (data inside this user's profile). */
export function perUserConfigFile() {
  if (!app.isPackaged || process.env.HEROMARKET_USER_DATA) return null
  return join(app.getPath('userData'), 'heromarket.json')
}

// Versions before the PostgreSQL release (≤ 1.3) stored one SQLite file in this folder, named after
// the open-source project the code base started from. It is only read, once, to import the store's
// data (see backend.js); nothing is ever written there.
const PRE_POSTGRES_DATA_DIR = 'elnagdi-pos'

/**
 * Where a pre-PostgreSQL installation keeps its database. Development builds and QA folders look only
 * inside their own data folder, never at the installed store's file.
 */
export function legacyDatabaseFile() {
  return process.env.HEROMARKET_USER_DATA || !app.isPackaged
    ? join(app.getPath('userData'), 'market_unified.db')
    : join(app.getPath('appData'), folders.legacyDir || PRE_POSTGRES_DATA_DIR, 'market_unified.db')
}
