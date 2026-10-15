import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Renderer API. There is deliberately no SQL channel: data goes through named service operations,
// which the HeroMarket service authorises (see src/server and .docs/ARCHITECTURE.md).
const api = {
  call: (op, body) => ipcRenderer.invoke('api:call', op, body),
  backend: {
    status: () => ipcRenderer.invoke('backend:status'),
    configure: (cfg) => ipcRenderer.invoke('backend:configure', cfg)
  },
  db: {
    backup: () => ipcRenderer.invoke('backup:save'),
    restore: () => ipcRenderer.invoke('backup:restore')
  },
  printer: {
    // Legacy HTML sale receipts (reprint of old invoices)
    print: (htmlContent, options) => ipcRenderer.invoke('print-receipt', htmlContent, options),
    // Shift-close, Momkn and wallets reports: kind = 'shift' | 'momkn' | 'wallets'
    printReport: (kind, data) => ipcRenderer.invoke('print-report', kind, data),
    // Sale receipts through the active receipt template
    printSale: (data, options) => ipcRenderer.invoke('print-sale', data, options),
    saleToPdf: (data, config) => ipcRenderer.invoke('sale-pdf', data, config),
    testTemplate: (config, data) => ipcRenderer.invoke('print-template-test', config, data)
  },
  generateShortagesPdf: (items) => ipcRenderer.invoke('generate-shortages-pdf', items),
  printShortagesToPrinter: (items) => ipcRenderer.invoke('print-shortages-to-printer', items)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
