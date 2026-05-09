// ---------------------------------------------------------------------------
// icon.ts
//
// Generates the Hotaru tray icon at runtime as a 32×32 RGBA PNG —
// no external assets, no build tools, no extra dependencies.
//
// The icon is a firefly: a soft amber glow (radial gradient) with a bright
// core, on a transparent background. Uses only Node's built-in zlib module
// for PNG IDAT compression.
//
// On macOS the same image is used; call nativeImage.setIsTemplateImage(true)
// if you later want system-adaptive light/dark mode behaviour.
// ---------------------------------------------------------------------------

import { deflateSync } from 'zlib'
import { nativeImage, NativeImage } from 'electron'

// ---------------------------------------------------------------------------
// Minimal PNG encoder (no dependencies)
// ---------------------------------------------------------------------------

/** Pre-computed CRC32 lookup table (standard polynomial 0xEDB88320) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const crcVal = crc32(Buffer.concat([typeBytes, data]))
  return Buffer.concat([u32be(data.length), typeBytes, data, u32be(crcVal)])
}

function buildPNG(width: number, height: number, rgba: Uint8Array): Buffer {
  // PNG file signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR: dimensions + 8-bit RGBA (colour type 6)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // bytes 10-12 (compression, filter, interlace) are already 0

  // Raw scanlines: each row prefixed by a filter byte of 0 (None)
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0 // filter byte
    rgba.copyWithin(0, 0)        // no-op; just ensures tsc doesn't elide the arg
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * (1 + width * 4) + 1 + x * 4
      raw[dst]     = rgba[src]
      raw[dst + 1] = rgba[src + 1]
      raw[dst + 2] = rgba[src + 2]
      raw[dst + 3] = rgba[src + 3]
    }
  }

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---------------------------------------------------------------------------
// Firefly pixel art
// ---------------------------------------------------------------------------

function renderFirefly(size: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const maxR = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5
      const dy = y - cy + 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > maxR) continue // outside circle → transparent

      // Smooth glow falloff (cubic)
      const t = 1 - dist / maxR
      const glow = t * t * t

      // Tight bright core
      const core = Math.max(0, 1 - dist / (maxR * 0.28))

      // Amber palette: outer #FBBF24, inner nearly white-amber
      const r = Math.min(255, Math.round(251 * glow + 60 * core))
      const g = Math.min(255, Math.round(191 * glow + 50 * core))
      const b = Math.min(255, Math.round(36  * glow + 10 * core))
      const a = Math.min(255, Math.round(240 * glow))

      const i = (y * size + x) * 4
      rgba[i]     = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = a
    }
  }

  return rgba
}

// ---------------------------------------------------------------------------
// Public: build and return the NativeImage
// ---------------------------------------------------------------------------

export function createFireflyIcon(): NativeImage {
  const size = 32
  const rgba = renderFirefly(size)
  const pngBuffer = buildPNG(size, size, rgba)
  return nativeImage.createFromBuffer(pngBuffer, { scaleFactor: 1 })
}
