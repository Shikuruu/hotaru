import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // Two separate HTML entry points: panel (tray dropdown) and overlay (fullscreen)
        input: {
          panel: resolve('src/renderer/panel.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    }
  }
})
