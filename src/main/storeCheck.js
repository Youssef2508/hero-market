// Why an installed shop's own database cannot open (no Electron imports: tests use it directly).
// Every answer here is a store problem, explained on its own screen with a retry; none of them is a
// reason to offer the connection settings (owner's laptop, 2026-10-16: a failed preparation showed
// the connection screen).
import { newerVersion } from './versions.js'

/** An error the start-up screen explains (code) rather than offering connection settings. */
export const storeError = (code, message) => Object.assign(new Error(message), { code })

/**
 * Checks done before an installed store (database service) starts. cfg is readConfig(): null when
 * the file and its copy are both unreadable, { mode: 'local' } when there is no file. Returns the
 * error to show, or null when the store may start. Other modes (standalone, client) are not checked.
 */
export function installedStoreProblem(cfg, appVersion) {
  if (!cfg) {
    return storeError(
      'config_damaged',
      'ملف إعدادات المتجر على هذا الجهاز تالف. شغّل برنامج تثبيت HeroMarket مرة أخرى (يحتاج موافقة المسؤول)؛ لا يتم حذف أي بيانات.'
    )
  }
  if ((cfg.mode || 'local') !== 'local') return null
  if (!cfg.local || !cfg.local.service) {
    return storeError(
      'store_not_prepared',
      'لم يتم تجهيز قاعدة بيانات المتجر على هذا الجهاز. شغّل برنامج تثبيت HeroMarket مرة أخرى (يحتاج موافقة المسؤول).'
    )
  }
  if (newerVersion(cfg.local.setupVersion, appVersion)) {
    return storeError(
      'database_newer',
      `بيانات هذا الجهاز حُدِّثت بالنسخة ${cfg.local.setupVersion}، وهي أحدث من هذا البرنامج (${appVersion}). ثبّت النسخة الأحدث مرة أخرى، أو استعد النسخة الاحتياطية المأخوذة قبل التحديث (دليل التحديث).`
    )
  }
  if (cfg.local.setupVersion !== appVersion) {
    return storeError(
      'setup_incomplete',
      'لم يكتمل تجهيز قاعدة البيانات لهذه النسخة، فلم يتم تحديث البيانات. شغّل برنامج تثبيت HeroMarket مرة أخرى.'
    )
  }
  return null
}

/** The code kept for a failed start: the error's own, else "store_failed" for an installed store. */
export function failureCode(err, { cfg, installed }) {
  if (err && err.code) return err.code
  return installed && (!cfg || (cfg.mode || 'local') === 'local') ? 'store_failed' : null
}
