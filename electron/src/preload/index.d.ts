// Type declarations for the API exposed via contextBridge in preload/index.ts
declare global {
  interface Window {
    hotaru: {
      onPushToTalkStart: (callback: () => void) => void
      onPushToTalkStop: (callback: () => void) => void
      pushToTalkStop: () => void
      showOverlay: () => void
      hideOverlay: () => void
      removeAllListeners: (channel: string) => void
    }
  }
}

export {}
