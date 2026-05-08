// Type declarations for the API exposed via contextBridge in preload/index.ts
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
