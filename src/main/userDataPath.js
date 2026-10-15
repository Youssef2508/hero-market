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
