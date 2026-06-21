import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  // Lets the runner detect the packaged desktop shell so it can route the
  // Telegram bridge return through the allow-listed mockstream:// deep link
  // instead of the loopback origin (which the bridge rejects).
  isDesktop: true,
  appVersion: () => ipcRenderer.invoke('app:version'),
  platform: process.platform
})
