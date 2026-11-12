// The browser's side of `window.api` (Phase 2 milestone 2, D-101).
//
// In the desktop program the preload script provides `window.api` and every screen calls the
// service through it. In a browser there is no preload: this file provides the same object, so the
// same screens run unchanged. Calls go to the cloud over HTTPS; the session is an HTTP-only cookie
// the page can neither read nor send by accident (the service also requires the header below).
//
// What a browser cannot do is said plainly instead of failing silently: the desktop's receipt
// printer, its backup files and its connection settings.

import packageInfo from '../../../../package.json'
import { noteServerVersion, setOwnVersion } from './appUpdate'
import {
  showReport,
  showSaleInvoice,
  showSaleReceipt,
  showShortages,
  showTemplateTest
} from './webReceipt'

const NOT_HERE = (what) => () =>
  Promise.reject(new Error(`${what} متاح من برنامج HeroMarket على جهاز المتجر فقط.`))

// One id per attempt: if the answer is lost and the screen tries again, the same operation is
// recognised and never carried out twice (D-101).
const newId = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
  )

async function call(op, body) {
  let res
  try {
    res = await fetch(`/api/${op}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-heromarket-web': '1',
        'x-heromarket-operation-id': newId(),
        'x-heromarket-terminal': terminalName()
      },
      body: JSON.stringify(body || {})
    })
  } catch {
    return {
      status: 503,
      error: {
        code: 'server_unreachable',
        message: 'تعذر الاتصال بخادم HeroMarket. تحقق من اتصال الإنترنت.'
      }
    }
  }
  noteServerVersion(res.headers.get('x-heromarket-version'))
  let json = null
  try {
    json = await res.json()
  } catch {
    /* empty answer */
  }
  if (res.status >= 400)
    return {
      status: res.status,
      error: json?.error || { code: 'error', message: 'حدث خطأ غير متوقع.' }
    }
  return { status: res.status, data: json }
}

/** A short name for this device in the session list and the audit log. */
function terminalName() {
  const ua = navigator.userAgent || ''
  const device = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Browser'
  // Sent as a request header, which carries Latin letters only.
  return `Internet - ${device}`
}

export function installWebBridge() {
  setOwnVersion(packageInfo.version)
  if (window.api) return false // the desktop program: its own bridge is already there
  window.api = {
    isWeb: true,
    call,
    backend: {
      status: async () => ({
        configured: true,
        mode: 'web',
        ready: true,
        error: null,
        errorCode: null,
        installedStore: false,
        terminalName: terminalName()
      }),
      retry: async () => ({ configured: true, mode: 'web', ready: true }),
      configure: NOT_HERE('إعداد الاتصال'),
      pickServerCa: NOT_HERE('إعداد الاتصال')
    },
    db: {
      backup: NOT_HERE('النسخ الاحتياطي'),
      restore: NOT_HERE('استعادة النسخة الاحتياطية'),
      nightlyStatus: async () => null,
      afterClose: async () => null
    },
    printer: {
      print: NOT_HERE('الطباعة على طابعة الإيصالات'),
      // What the shop would print is shown on screen as the paper would look: print or save as
      // PDF, or share. It is saved either way; the shop PC can print it at any time (D-106).
      printReport: (kind, data) => showReport(call, kind, data),
      printSale: (data) => showSaleReceipt(call, data),
      saleToPdf: (data) => showSaleInvoice(call, data),
      testTemplate: (config, data) => showTemplateTest(call, config, data)
    },
    generateShortagesPdf: (items) => showShortages(call, items),
    printShortagesToPrinter: (items) => showShortages(call, items)
  }
  document.documentElement.setAttribute('data-way-in', 'web')
  return true
}
