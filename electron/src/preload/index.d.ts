// Type declarations for the API exposed via contextBridge in preload/index.ts

// One captured display — returned as an array (one entry per connected screen)
interface ScreenshotResult {
  displayName: string  // e.g. "Screen 1", "Built-in Retina Display"
  base64Jpeg: string   // base64-encoded JPEG, no data-URL prefix
  width: number
  height: number
}

// A single parsed [POINT] annotation from a Claude response
interface OverlayPoint {
  x: number      // 0–1 fraction of screen width
  y: number      // 0–1 fraction of screen height
  label: string  // short description shown near the firefly cursor
  screen: string // display name (e.g. "Screen 1")
}

declare global {
  interface Window {
    hotaru: {
      // Push-to-talk
      onPushToTalkStart: (callback: () => void) => void
      onPushToTalkStop: (callback: () => void) => void
      pushToTalkStop: () => void

      // Overlay visibility
      showOverlay: () => void
      hideOverlay: () => void

      // Microphone permission
      requestMicPermission: () => Promise<boolean>

      // Screenshot capture (all connected displays, JPEG base64)
      captureScreenshot: () => Promise<ScreenshotResult[]>

      // OS keychain (backed by keytar → Windows Credential Manager / macOS Keychain)
      keychainGet: (account: string) => Promise<string | null>
      keychainSet: (account: string, value: string) => Promise<void>
      keychainDelete: (account: string) => Promise<boolean>

      // Overlay point annotations
      sendOverlayPoints: (points: OverlayPoint[]) => void
      onOverlayPoint: (callback: (points: OverlayPoint[]) => void) => void

      // Cleanup
      removeAllListeners: (channel: string) => void
    }
  }
}

export {}
