import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  db: {
    execute: (sqlQuery) => ipcRenderer.invoke('execute-sql', sqlQuery),
    backup: () => ipcRenderer.invoke('backup-database'),
    restore: () => ipcRenderer.invoke('restore-database')
  },
  printer: {
    print: (htmlContent, options) => ipcRenderer.invoke('print-receipt', htmlContent, options)
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
