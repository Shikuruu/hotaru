#!/usr/bin/env node
// ---------------------------------------------------------------------------
// generate-icons.js
//
// Generates all icon assets needed by electron-builder — no external packages,
// no design tools, just Node.js built-ins.
//
// Outputs:
//   resources/icon.png   — 1024×1024 PNG  (fallback / source)
//   resources/icon.ico   — multi-size ICO (Windows)
//   resources/icon.icns  — multi-size ICNS (macOS)
//
// Run before packaging:  node scripts/generate-icons.js
// ---------------------------------------------------------------------------

'use strict'

const { deflateSync } = require('zlib')
const { writeFileSync, mkdirSync } = require('fs')
const { join } = require('path')

const RESOURCES = join(__dirname, '..', 'resources')
mkdirSync(RESOURCES, { recursive: true })

// ===========================================================================
// Minimal PNG encoder (no deps)
// ===========================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function u32be(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const crcVal = crc32(Buffer.concat([typeBytes, data]))
  return Buffer.concat([u32be(data.length), typeBytes, data, u32be(crcVal)])
}

function buildPNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA

  // Raw scanlines: filter byte 0 + RGBA row
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      const dst = y * (1 + width * 4) + 1 + x * 4
      raw[dst]     = rgba[src]
      raw[dst + 1] = rgba[src + 1]
      raw[dst + 2] = rgba[src + 2]
      raw[dst + 3] = rgba[src + 3]
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ===========================================================================
// Firefly pixel renderer — amber radial glow with bright core
// ===========================================================================

function renderFirefly(size) {
  const rgba = new Uint8Array(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const maxR = size / 2

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5
      const dy = y - cy + 0.5
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > maxR) continue

      const t = 1 - dist / maxR
      const glow = t * t * t              // cubic falloff
      const core = Math.max(0, 1 - dist / (maxR * 0.28)) // tight bright centre

      const i = (y * size + x) * 4
      rgba[i]     = Math.min(255, Math.round(251 * glow + 60 * core))   // R
      rgba[i + 1] = Math.min(255, Math.round(191 * glow + 50 * core))   // G
      rgba[i + 2] = Math.min(255, Math.round(36  * glow + 10 * core))   // B
      rgba[i + 3] = Math.min(255, Math.round(240 * glow))               // A
    }
  }
  return rgba
}

function fireflyPNG(size) {
  return buildPNG(size, size, renderFirefly(size))
}

// ===========================================================================
// ICO encoder — modern format: PNG images packed into an ICO container
// (supported by Windows Vista+ and all modern Windows versions)
// ===========================================================================

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function buildICO(pngMap) {
  const sizes = ICO_SIZES.filter((s) => pngMap.has(s))
  const count = sizes.length

  // Header: 6 bytes
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)     // reserved
  header.writeUInt16LE(1, 2)     // type: 1 = icon
  header.writeUInt16LE(count, 4)

  // Directory entries: 16 bytes each
  const DIR_ENTRY_SIZE = 16
  let dataOffset = 6 + count * DIR_ENTRY_SIZE

  const dirEntries = []
  const imageBuffers = []

  for (const size of sizes) {
    const png = pngMap.get(size)
    const entry = Buffer.alloc(DIR_ENTRY_SIZE)
    entry[0] = size >= 256 ? 0 : size  // 0 = 256px in ICO spec
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0   // color count (0 = >256 colors)
    entry[3] = 0   // reserved
    entry.writeUInt16LE(1, 4)          // color planes
    entry.writeUInt16LE(32, 6)         // bits per pixel
    entry.writeUInt32LE(png.length, 8) // image data size
    entry.writeUInt32LE(dataOffset, 12)// offset to image data

    dirEntries.push(entry)
    imageBuffers.push(png)
    dataOffset += png.length
  }

  return Buffer.concat([header, ...dirEntries, ...imageBuffers])
}

// ===========================================================================
// ICNS encoder — Apple icon format, PNG images in typed blocks
//
// Type codes (modern, PNG-inside-ICNS):
//   ic11 = 16×16       ic12 = 32×32       ic13 = 64×64
//   ic07 = 128×128     ic08 = 256×256     ic09 = 512×512     ic10 = 1024×1024
// ===========================================================================

const ICNS_SIZES = [
  { size: 16,   type: 'ic11' },
  { size: 32,   type: 'ic12' },
  { size: 64,   type: 'ic13' },
  { size: 128,  type: 'ic07' },
  { size: 256,  type: 'ic08' },
  { size: 512,  type: 'ic09' },
  { size: 1024, type: 'ic10' }
]

function buildICNS(pngMap) {
  const blocks = []

  for (const { size, type } of ICNS_SIZES) {
    if (!pngMap.has(size)) continue
    const png = pngMap.get(size)
    const typeBytes = Buffer.from(type, 'ascii')
    const blockSize = 8 + png.length  // 4 type + 4 length + data
    const sizeBuf = Buffer.alloc(4)
    sizeBuf.writeUInt32BE(blockSize, 0)
    blocks.push(Buffer.concat([typeBytes, sizeBuf, png]))
  }

  const body = Buffer.concat(blocks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(8 + body.length, 4) // total file size

  return Buffer.concat([header, body])
}

// ===========================================================================
// Main — render all needed sizes and write the three output files
// ===========================================================================

console.log('Generating Hotaru firefly icons…')

const allSizes = [...new Set([...ICO_SIZES, ...ICNS_SIZES.map((e) => e.size)])]
const pngMap = new Map()

for (const size of allSizes) {
  process.stdout.write(`  Rendering ${size}×${size}… `)
  pngMap.set(size, fireflyPNG(size))
  process.stdout.write('done\n')
}

const icoBuf  = buildICO(pngMap)
const icnsBuf = buildICNS(pngMap)
const pngBuf  = pngMap.get(1024)

writeFileSync(join(RESOURCES, 'icon.png'),  pngBuf)
writeFileSync(join(RESOURCES, 'icon.ico'),  icoBuf)
writeFileSync(join(RESOURCES, 'icon.icns'), icnsBuf)

console.log(`\nWrote:`)
console.log(`  resources/icon.png   ${pngBuf.length.toLocaleString()} bytes (1024×1024)`)
console.log(`  resources/icon.ico   ${icoBuf.length.toLocaleString()} bytes (${ICO_SIZES.join(', ')}px)`)
console.log(`  resources/icon.icns  ${icnsBuf.length.toLocaleString()} bytes (${ICNS_SIZES.map(e=>e.size).join(', ')}px)`)
