// Store profile + receipt templates for printing, read through the service (no database access here).
import { readConfig } from './backend'

const FALLBACK = {
  storeName: 'هيرو ماركت',
  branchName: 'الفرع الرئيسي',
  printerName: 'CITIZEN CT-S300',
  store: { name: 'هيرو ماركت', branch: 'الفرع الرئيسي', address: '', phone: '' },
  logo: '',
  paper: '80mm',
  templates: {}
}

export async function getPrintSettings(callOperation) {
  const out = { ...FALLBACK, store: { ...FALLBACK.store } }
  try {
    const res = await callOperation('settings.public', {})
    const s = res.data?.settings
    if (s) {
      out.storeName = s.store_name || out.storeName
      out.branchName = s.branch_name || out.branchName
      out.printerName = s.printer_name || out.printerName
      out.store = {
        name: out.storeName,
        branch: out.branchName,
        address: s.store_address || '',
        phone: s.store_phone || ''
      }
      out.logo = s.store_logo || ''
      out.paper = s.receipt_paper || '80mm'
      out.templates = res.data.receiptTemplates || {}
    }
  } catch (err) {
    console.error('[PRINTER] Failed to read settings from the service:', err.message)
  }
  // A till can override the store's default printer in its local config.
  const local = readConfig() || {}
  if (local.printerName) out.printerName = local.printerName
  return out
}
