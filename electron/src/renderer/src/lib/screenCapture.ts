// ---------------------------------------------------------------------------
// screenCapture.ts
//
// Renderer-side wrapper around the desktopCapturer IPC bridge.
// Calls the main process 'capture-screenshot' handler via window.hotaru
// and re-exports a clean typed interface for the rest of the renderer.
// ---------------------------------------------------------------------------

export interface ScreenCapture {
  displayName: string   // e.g. "Screen 1", "Built-in Retina Display"
  base64Jpeg: string    // base64-encoded JPEG, no data-URL prefix
  width: number
  height: number
}

/**
 * Captures a JPEG snapshot of every connected display.
 * Returns an array — one entry per screen — ready to pass to Claude Vision.
 * Throws if the IPC call fails (e.g. permission denied on macOS).
 */
export async function captureAllScreens(): Promise<ScreenCapture[]> {
  return window.hotaru.captureScreenshot()
}
