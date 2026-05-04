import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

// Prevent the app from showing in the dock (macOS) or taskbar
app.dock?.hide()

let tray: Tray | null = null
let panelWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

// ---------------------------------------------------------------------------
// Panel window — the dropdown that opens when the user clicks the tray icon
// ---------------------------------------------------------------------------
function createPanelWindow(): BrowserWindow {
  const panel = new BrowserWindow({
    width: 360,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    panel.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/panel.html')
  } else {
    panel.loadFile(join(__dirname, '../renderer/panel.html'))
  }

  // Hide panel when it loses focus (click outside)
  panel.on('blur', () => {
    panel.hide()
  })

  return panel
}

// ---------------------------------------------------------------------------
// Overlay window — fullscreen transparent layer for the cursor and responses
// ---------------------------------------------------------------------------
function createOverlayWindow(): BrowserWindow {
  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.bounds

  const overlay = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Make the overlay click-through so it never blocks user interaction
  overlay.setIgnoreMouseEvents(true, { forward: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    overlay.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/overlay.html')
  } else {
    overlay.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  overlay.showInactive()

  return overlay
}

// ---------------------------------------------------------------------------
// Tray icon
// ---------------------------------------------------------------------------
function createTray(): void {
  // Use a 16x16 empty placeholder icon for now — replace with real icon later
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Hotaru')

  // Left click toggles the panel
  tray.on('click', () => {
    if (!panelWindow) return
    if (panelWindow.isVisible()) {
      panelWindow.hide()
    } else {
      const trayBounds = tray!.getBounds()
      const windowBounds = panelWindow.getBounds()
      // Position the panel above the tray icon, centered
      const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2)
      const y = Math.round(trayBounds.y - windowBounds.height - 8)
      panelWindow.setPosition(x, y)
      panelWindow.show()
      panelWindow.focus()
    }
  })

  // Right click shows a minimal context menu with Quit
  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([{ label: 'Quit Hotaru', click: () => app.quit() }])
    tray!.popUpContextMenu(contextMenu)
  })
}

// ---------------------------------------------------------------------------
// Global push-to-talk shortcut (Ctrl + Alt)
// ---------------------------------------------------------------------------
function registerGlobalShortcut(): void {
  // On key down — start recording
  globalShortcut.register('CommandOrControl+Alt+Space', () => {
    overlayWindow?.webContents.send('push-to-talk-start')
    panelWindow?.webContents.send('push-to-talk-start')
  })
}

// ---------------------------------------------------------------------------
// IPC handlers — renderer process communicates back to main via these
// ---------------------------------------------------------------------------
function registerIpcHandlers(): void {
  // Renderer asks to show/hide the overlay
  ipcMain.on('overlay-show', () => overlayWindow?.showInactive())
  ipcMain.on('overlay-hide', () => overlayWindow?.hide())

  // Renderer signals push-to-talk released (key up comes from renderer side
  // since globalShortcut only fires on key down)
  ipcMain.on('push-to-talk-stop', () => {
    overlayWindow?.webContents.send('push-to-talk-stop')
    panelWindow?.webContents.send('push-to-talk-stop')
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createTray()
  panelWindow = createPanelWindow()
  overlayWindow = createOverlayWindow()
  registerGlobalShortcut()
  registerIpcHandlers()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Keep the app running even if all windows are closed (menu bar app pattern)
app.on('window-all-closed', () => {
  // Do nothing — the tray keeps the app alive
})
