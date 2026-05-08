// Type declarations for the API exposed via contextBridge in preload/index.ts

// One captured display — returned as an array (one entry per connected screen)
interface ScreenshotResult {
  displayName: string  // e.g. "Screen 1", "Built-in Retina Display"
  base64Jpeg: string   // base64-encoded JPEG, no data-URL prefix
  width: number
  height: number
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

      // Cleanup
      removeAllListeners: (channel: string) => void
    }
  }
}

export {}
