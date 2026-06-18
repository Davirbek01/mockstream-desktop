import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  appVersion: () => ipcRenderer.invoke('app:version'),
  platform: process.platform
})
