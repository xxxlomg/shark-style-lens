import type { PageContext } from '../../shared/schemas/style-profile'
import type { SubtreeColor } from './subtree'

const DARK_BRIGHTNESS = 0.35
const PALETTE_DISTANCE = 24
const PALETTE_TOP = 8

type Rgb = [number, number, number]

function parseRgb(value: string): Rgb | null {
  const m = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  const hex = value.match(/#([0-9a-f]{6})\b/i)
  if (hex) {
    const n = Number.parseInt(hex[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return null
}

function toHex(rgb: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`
}

/** 感知亮度 0..1（< DARK_BRIGHTNESS 视为深色） */
function brightness(rgb: Rgb): number {
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
}

function distance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

function isTransparent(value: string): boolean {
  return !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
}

/** 页面实际背景：body → html，颜色优先，其次渐变/图片原文 */
function detectPageBackground(): string | undefined {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue
    const cs = getComputedStyle(el)
    if (!isTransparent(cs.backgroundColor)) return cs.backgroundColor
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const img = cs.backgroundImage
      return img.length > 120 ? `${img.slice(0, 120)}…` : img
    }
  }
  return undefined
}

/** 多信号投票判定 dark/light（亮度权重最高，§T2） */
function detectScheme(pageBackground: string | undefined): 'dark' | 'light' | 'unknown' {
  let dark = 0
  let light = 0

  const bgRgb = pageBackground ? parseRgb(pageBackground) : null
  if (bgRgb) {
    if (brightness(bgRgb) < DARK_BRIGHTNESS) dark += 2
    else light += 2
  }

  const html = document.documentElement
  const dataTheme = (html.getAttribute('data-theme') ?? '').toLowerCase()
  if (dataTheme.includes('dark')) dark += 2
  else if (dataTheme.includes('light')) light += 2
  for (const el of [html, document.body]) {
    if (!el) continue
    const cls = Array.from(el.classList).join(' ').toLowerCase()
    if (/\bdark\b|theme-dark/.test(cls)) dark += 1
    if (/\blight\b|theme-light/.test(cls)) light += 1
  }

  const meta = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? ''
  if (meta.includes('dark') && !meta.includes('light')) dark += 1
  else if (meta.includes('light') && !meta.includes('dark')) light += 1

  if (window.matchMedia('(prefers-color-scheme: dark)').matches) dark += 1
  else light += 1

  if (dark === light) return 'unknown'
  return dark > light ? 'dark' : 'light'
}

/** 颜色聚合：RGB 距离去重 + 频次排序 top 8 */
function aggregatePalette(samples: SubtreeColor[]): PageContext['palette'] {
  const entries: Array<{ rgb: Rgb; hex: string; count: number; usage: string }> = []
  for (const sample of samples) {
    const rgb = parseRgb(sample.value)
    if (!rgb) continue
    const hit = entries.find((e) => distance(e.rgb, rgb) < PALETTE_DISTANCE)
    if (hit) {
      hit.count += 1
    } else {
      entries.push({ rgb, hex: toHex(rgb), count: 1, usage: sample.usage })
    }
  }
  return entries
    .sort((a, b) => b.count - a.count)
    .slice(0, PALETTE_TOP)
    .map((e) => ({ hex: e.hex, count: e.count, usage: e.usage }))
}

/** 页面主题与调色板（保真度提升 T2）：samples 含目标自身 + 子树颜色 */
export function analyzePageContext(samples: SubtreeColor[]): PageContext {
  const pageBackground = detectPageBackground()
  return {
    pageBackground,
    scheme: detectScheme(pageBackground),
    palette: aggregatePalette(samples),
  }
}
