/**
 * Draw the AIR logo: three brush-like spirals in a triangle, joined by sweeping tails.
 * Original artwork generated from the parameters below. The triple spiral is a public-domain
 * motif; this drawing (one spiral on top, two below, counter-clockwise curls, tails that sweep
 * around the next spiral) copies no existing emblem.
 * Writes air/branding/air-logo.svg (dark) and air-logo-light.svg.
 * Run: pnpm -C air exec tsx scripts/gen-logo.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SIZE = 512
const CENTRE = SIZE / 2
/** Distance from the logo centre to each spiral centre. */
const ARM = 108
/** Outer radius of a spiral, the fraction left at its inner tip, and its turns. */
const COIL = 78
const INNER = 0.12
const TURNS = 1.9
/** Stroke width at the outer coil, at the inner tip, and at the end of the tail. */
const WIDE = 24
const TIP = 5
const TAIL_END = 2
/** Tail length in radians around the logo centre. */
const TAIL = 1.55

type Point = readonly [number, number]

/** Centre line of one spiral plus its tail, from the tail end to the inner tip, with a width per point. */
function stroke(k: number): { points: Point[]; widths: number[] } {
  const theta = -Math.PI / 2 + (Math.PI * 2 * k) / 3
  const cx = CENTRE + ARM * Math.cos(theta)
  const cy = CENTRE + ARM * Math.sin(theta)
  const points: Point[] = []
  const widths: number[] = []
  // Tail: an arc around the logo centre that ends tangent to the spiral's outer coil.
  const tailRadius = ARM + COIL
  const tailSteps = 90
  for (let i = 0; i <= tailSteps; i++) {
    const t = i / tailSteps
    const a = theta - TAIL * (1 - t)
    const r = tailRadius - 18 * (1 - t)
    points.push([CENTRE + r * Math.cos(a), CENTRE + r * Math.sin(a)])
    widths.push(TAIL_END + (WIDE - TAIL_END) * t * t)
  }
  // Spiral: continues the tail's direction of travel, from the outermost point (away from the logo centre) inward.
  const steps = 260
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const r = COIL * (1 - (1 - INNER) * t)
    const a = theta + t * TURNS * Math.PI * 2
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    widths.push(WIDE + (TIP - WIDE) * t)
  }
  return { points, widths }
}

/** Outline of a variable-width stroke as one closed path. */
function outline({ points, widths }: { points: Point[]; widths: number[] }): string {
  const left: Point[] = []
  const right: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]!
    const [px, py] = points[Math.max(0, i - 1)]!
    const [nx, ny] = points[Math.min(points.length - 1, i + 1)]!
    const dx = nx - px
    const dy = ny - py
    const len = Math.hypot(dx, dy) || 1
    const h = widths[i]! / 2
    left.push([x - (dy / len) * h, y + (dx / len) * h])
    right.push([x + (dy / len) * h, y - (dx / len) * h])
  }
  const ring = [...left, ...right.reverse()]
  return `M ${ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`
}

function svg(colour: string): string {
  const paths = [0, 1, 2].map(k => `<path d="${outline(stroke(k))}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">`
    + `<title>AIR</title><g fill="${colour}" stroke="${colour}" stroke-width="1.5" stroke-linejoin="round">${paths}</g></svg>\n`
}

const out = join(import.meta.dirname, '..', 'branding')
writeFileSync(join(out, 'air-logo.svg'), svg('#111827'))
writeFileSync(join(out, 'air-logo-light.svg'), svg('#F9FAFB'))
console.log('wrote', out)
