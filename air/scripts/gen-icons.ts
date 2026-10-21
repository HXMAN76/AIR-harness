/**
 * Render the AIR application icons from air/branding/air-logo.svg into apps/desktop/resources.
 * Choice: the dark mark (#111827) on a white rounded-square tile, used for every icon.
 * Writes icon.svg/.png (1104), icon-windows.svg/.png (1024), icon-macos.svg/.png (1024), and
 * tray-windows.ico (PNG-in-ICO, the sizes apps/desktop/tests/tray-icon.spec.ts expects).
 * sharp comes from apps/desktop (already a dependency there); no new dependency.
 * Run: pnpm -C air exec tsx scripts/gen-icons.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const resources = join(root, 'apps', 'desktop', 'resources')
const require = createRequire(join(root, 'apps', 'desktop', 'package.json'))
type SharpFactory = (input: Buffer, options?: { density: number }) => {
  resize: (width: number, height: number) => { png: () => { toBuffer: () => Promise<Buffer> } }
}
const sharp = require('sharp') as SharpFactory

const TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64] as const
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Inner markup of the 512-unit dark logo. */
const mark = readFileSync(join(root, 'air', 'branding', 'air-logo.svg'), 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[^<]*<\/title>/, '')

interface Layout {
  readonly canvas: number
  /** Tile left/top offset and edge on the canvas. */
  readonly x: number
  readonly y: number
  readonly tile: number
  readonly radius: number
  /** Edge of the 512-unit logo canvas as a fraction of the tile (the drawn mark fills about 73% of that canvas). */
  readonly markFraction: number
  readonly shadow: boolean
}

function iconSvg(l: Layout): string {
  const markEdge = l.tile * l.markFraction
  const mx = l.x + (l.tile - markEdge) / 2
  const my = l.y + (l.tile - markEdge) / 2
  const filter = l.shadow
    ? '<defs><filter id="s" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#111827" flood-opacity="0.22"/></filter></defs>'
    : ''
  return `<svg width="${l.canvas}" height="${l.canvas}" viewBox="0 0 ${l.canvas} ${l.canvas}" fill="none" xmlns="http://www.w3.org/2000/svg">
<title>AIR</title>${filter}
<rect x="${l.x}" y="${l.y}" width="${l.tile}" height="${l.tile}" rx="${l.radius}" fill="#FFFFFF"${l.shadow ? ' filter="url(#s)"' : ''}/>
<g transform="translate(${mx} ${my}) scale(${markEdge / 512})">${mark}</g>
</svg>
`
}

async function png(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 72 * size / Number(/width="(\d+)"/.exec(svg)?.[1]) }).resize(size, size).png().toBuffer()
}

function packIco(entries: readonly { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach((e, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(e.size % 256, at)
    header.writeUInt8(e.size % 256, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(e.png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += e.png.length
  })
  return Buffer.concat([header, ...entries.map(e => e.png)])
}

const layouts = {
  icon: { canvas: 1104, x: 40, y: 32, tile: 1024, radius: 192, markFraction: 0.85, shadow: true },
  'icon-windows': { canvas: 1024, x: 32, y: 32, tile: 960, radius: 180, markFraction: 0.85, shadow: false },
  'icon-macos': { canvas: 1024, x: 100, y: 100, tile: 824, radius: 185, markFraction: 0.85, shadow: true },
} as const satisfies Record<string, Layout>

for (const [name, layout] of Object.entries(layouts)) {
  const svg = iconSvg(layout)
  writeFileSync(join(resources, `${name}.svg`), svg)
  writeFileSync(join(resources, `${name}.png`), await png(svg, layout.canvas))
}

// Tray: full-bleed tile with a larger mark so it stays legible at 16 px.
const tray = iconSvg({ canvas: 1024, x: 0, y: 0, tile: 1024, radius: 200, markFraction: 1.07, shadow: false })
const entries = await Promise.all(TRAY_SIZES.map(async size => ({ size, png: await png(tray, size) })))
for (const e of entries) if (!e.png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`icons: bad PNG at ${String(e.size)}`)
writeFileSync(join(resources, 'tray-windows.ico'), packIco(entries))
console.info('icons: wrote icon, icon-windows, icon-macos (svg+png) and tray-windows.ico')
