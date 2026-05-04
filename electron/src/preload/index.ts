import { contextBridge, ipcRenderer } from 'electron'

// ---------------------------------------------------------------------------
// Expose a safe, typed API surface to the renderer process.
// The renderer never gets direct access to Node or Electron internals.
// ---------------------------------------------------------------------------
contextBridge.exposeInMainWorld('hotaru', {
  // Push-to-talk events from main process → renderer
  onPushToTalkStart: (callback: () => void) =>
    ipcRenderer.on('push-to-talk-start', () => callback()),
  onPushToTalkStop: (callback: () => void) =>
    ipcRenderer.on('push-to-talk-stop', () => callback()),

  // Renderer → main process signals
  pushToTalkStop: () => ipcRenderer.send('push-to-talk-stop'),
  showOverlay: () => ipcRenderer.send('overlay-show'),
  hideOverlay: () => ipcRenderer.send('overlay-hide'),

  // Remove event listeners (cleanup)
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
})
