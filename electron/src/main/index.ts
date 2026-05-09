import { app, BrowserWindow, Tray, Menu, ipcMain, systemPreferences, desktopCapturer } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import keytar from 'keytar'
import { uIOhook, UiohookKey } from 'uiohook-napi'
import { createFireflyIcon } from './icon'

// Shape of screenshot data returned to the renderer per display
interface ScreenshotResult {
  displayName: string  // e.g. "Screen 1", "Built-in Retina Display"
  base64Jpeg: string   // base64-encoded JPEG, no data-URL prefix
  width: number
  height: number
}

// All API keys are stored under this service name in the OS keychain
// (Windows Credential Manager on Windows, Keychain on macOS)
const KEYTAR_SERVICE = 'hotaru'

// Tracks whether the push-to-talk combo is currently held down so we only
// fire push-to-talk-stop once per key-up and ignore unrelated Space presses.
let isPushToTalkActive = false

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
  const icon = createFireflyIcon()
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
// Global push-to-talk via uiohook-napi
//
// Unlike Electron's globalShortcut (which only fires on key DOWN), uiohook
// gives us both keydown and keyup events system-wide — exactly what we need
// for hold-to-talk behaviour. This mirrors the CGEvent tap used in the
// original Swift/macOS version.
//
// Combo: Ctrl + Alt + Space
// ---------------------------------------------------------------------------
function registerPushToTalkHook(): void {
  uIOhook.on('keydown', (event) => {
    // Detect Ctrl + Alt + Space held together
    const isCtrlAltSpace =
      event.ctrlKey && event.altKey && event.keycode === UiohookKey.Space

    if (isCtrlAltSpace && !isPushToTalkActive) {
      isPushToTalkActive = true
      overlayWindow?.webContents.send('push-to-talk-start')
      panelWindow?.webContents.send('push-to-talk-start')
    }
  })

  uIOhook.on('keyup', (event) => {
    // Fire stop when Space is released while PTT was active
    if (event.keycode === UiohookKey.Space && isPushToTalkActive) {
      isPushToTalkActive = false
      overlayWindow?.webContents.send('push-to-talk-stop')
      panelWindow?.webContents.send('push-to-talk-stop')
    }
  })

  uIOhook.start()
}

// ---------------------------------------------------------------------------
// IPC handlers — renderer process communicates back to main via these
// ---------------------------------------------------------------------------
function registerIpcHandlers(): void {
  // Renderer asks to show/hide the overlay
  ipcMain.on('overlay-show', () => overlayWindow?.showInactive())
  ipcMain.on('overlay-hide', () => overlayWindow?.hide())

  // Panel renderer sends parsed [POINT] data → forward to overlay renderer
  ipcMain.on('overlay-point', (_event, points: unknown) => {
    overlayWindow?.webContents.send('overlay-point', points)
  })

  // Renderer signals push-to-talk released (key up comes from renderer side
  // since globalShortcut only fires on key down)
  ipcMain.on('push-to-talk-stop', () => {
    overlayWindow?.webContents.send('push-to-talk-stop')
    panelWindow?.webContents.send('push-to-talk-stop')
  })

  // ---------------------------------------------------------------------------
  // Microphone permission handler
  //
  // On macOS the app must explicitly request mic access via systemPreferences.
  // On Windows, getUserMedia() in the renderer triggers the OS prompt automatically.
  // ---------------------------------------------------------------------------
  ipcMain.handle('request-mic-permission', async (): Promise<boolean> => {
    if (process.platform === 'darwin') {
      const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
      if (currentStatus === 'granted') return true
      return await systemPreferences.askForMediaAccess('microphone')
    }
    // Windows and Linux handle mic permission via the browser getUserMedia prompt
    return true
  })

  // ---------------------------------------------------------------------------
  // Screenshot capture handler
  //
  // Uses desktopCapturer to grab a JPEG snapshot of every connected display.
  // Returns an array so the renderer (and later Claude) can see all screens.
  // Thumbnails are capped at 1920×1080 and encoded as JPEG (85% quality) to
  // keep file sizes reasonable for the Claude Vision API.
  //
  // On macOS this requires Screen Recording permission — the first call will
  // trigger the OS permission prompt automatically.
  // ---------------------------------------------------------------------------
  ipcMain.handle('capture-screenshot', async (): Promise<ScreenshotResult[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    return sources.map((source, index) => {
      const jpegBuffer = source.thumbnail.toJPEG(85)
      const { width, height } = source.thumbnail.getSize()
      return {
        displayName: source.name || `Screen ${index + 1}`,
        base64Jpeg: jpegBuffer.toString('base64'),
        width,
        height
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Keychain handlers — keytar is a native Node module that can only run in
  // the main process. The renderer calls these via ipcRenderer.invoke().
  // ---------------------------------------------------------------------------

  // Get a single stored key by account name
  ipcMain.handle('keytar-get', async (_event, account: string): Promise<string | null> => {
    return await keytar.getPassword(KEYTAR_SERVICE, account)
  })

  // Store a key in the OS keychain
  ipcMain.handle('keytar-set', async (_event, account: string, value: string): Promise<void> => {
    await keytar.setPassword(KEYTAR_SERVICE, account, value)
  })

  // Delete a stored key (used when user clears/resets settings)
  ipcMain.handle('keytar-delete', async (_event, account: string): Promise<boolean> => {
    return await keytar.deletePassword(KEYTAR_SERVICE, account)
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  createTray()
  panelWindow = createPanelWindow()
  overlayWindow = createOverlayWindow()
  registerPushToTalkHook()
  registerIpcHandlers()
})

app.on('will-quit', () => {
  uIOhook.stop()
})

// Keep the app running even if all windows are closed (menu bar app pattern)
app.on('window-all-closed', () => {
  // Do nothing — the tray keeps the app alive
})
