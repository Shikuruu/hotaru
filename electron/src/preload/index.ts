import { contextBridge, ipcRenderer } from 'electron'

// Mirrors the ScreenshotResult interface defined in main/index.ts
interface ScreenshotResult {
  displayName: string
  base64Jpeg: string
  width: number
  height: number
}

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

  // Microphone permission request (needed on macOS; Windows handles via getUserMedia)
  requestMicPermission: (): Promise<boolean> => ipcRenderer.invoke('request-mic-permission'),

  // OS keychain access — keytar runs in main process, proxied here via IPC
  keychainGet: (account: string): Promise<string | null> =>
    ipcRenderer.invoke('keytar-get', account),
  keychainSet: (account: string, value: string): Promise<void> =>
    ipcRenderer.invoke('keytar-set', account, value),
  keychainDelete: (account: string): Promise<boolean> =>
    ipcRenderer.invoke('keytar-delete', account),

  // Screenshot capture — calls desktopCapturer in main process and returns
  // JPEG snapshots of every connected display as base64 strings
  captureScreenshot: (): Promise<ScreenshotResult[]> =>
    ipcRenderer.invoke('capture-screenshot'),

  // Remove event listeners (cleanup on component unmount)
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
})
