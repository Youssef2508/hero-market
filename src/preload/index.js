import { contextBridge, ipcRenderer } from 'electron'

// Renderer API. There is deliberately no SQL channel: data goes through named service operations,
// which the HeroMarket service authorises (see src/server and .docs/ARCHITECTURE.md).
// Only these named channels are reachable from the page: the generic ipcRenderer bridge of
// @electron-toolkit is not exposed (audit 1.4.0), so a page script cannot invoke any other channel.
// The preload runs sandboxed: it may only use the electron module's renderer APIs.
const api = {
  call: (op, body) => ipcRenderer.invoke('api:call', op, body),
  backend: {
    status: () => ipcRenderer.invoke('backend:status'),
    retry: () => ipcRenderer.invoke('backend:retry'),
    configure: (cfg) => ipcRenderer.invoke('backend:configure', cfg),
    pickServerCa: () => ipcRenderer.invoke('backend:pickServerCa')
  },
  db: {
    backup: () => ipcRenderer.invoke('backup:save'),
    restore: () => ipcRenderer.invoke('backup:restore'),
    nightlyStatus: () => ipcRenderer.invoke('backup:nightlyStatus')
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

// Context isolation is always on (src/main/index.js); the API is exposed through the bridge only.
contextBridge.exposeInMainWorld('api', api)
