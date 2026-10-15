import { app } from 'electron'
import { join } from 'path'

// Imported first by src/main/index.js so it runs before any module reads app.getPath('userData').
//
// HeroMarket keeps its data (local PostgreSQL cluster, configuration, backups, logs) in
// %APPDATA%\HeroMarket. HEROMARKET_USER_DATA points a session at another folder (QA of first-run
// and upgrade flows on a copy of a store's data, support diagnostics) without touching real data.
// Development and preview builds use their own folder, so they never open the installed store's data.
app.setPath(
  'userData',
  process.env.HEROMARKET_USER_DATA ||
    join(app.getPath('appData'), app.isPackaged ? 'HeroMarket' : 'HeroMarket-dev')
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
    : join(app.getPath('appData'), PRE_POSTGRES_DATA_DIR, 'market_unified.db')
}
