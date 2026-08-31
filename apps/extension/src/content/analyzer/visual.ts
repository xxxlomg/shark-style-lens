import type {
  BackgroundInfo,
  BorderInfo,
  ColorInfo,
  RadiusInfo,
  ShadowInfo,
  VisualProfile,
} from '../../shared/schemas/style-profile'
import { sanitizeCssValue } from './privacy'

interface ParsedRgb {
  channels: [number, number, number]
  alpha: number
}

function parseCssChannel(value: string): number | undefined {
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed)) return undefined
  return value.trim().endsWith('%') ? (parsed / 100) * 255 : parsed
}

function parseCssAlpha(value: string): number | undefined {
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed)) return undefined
  const alpha = value.trim().endsWith('%') ? parsed / 100 : parsed
  return Math.max(0, Math.min(1, alpha))
}

function parseRgbFunction(value: string): ParsedRgb | undefined {
  const match = value.trim().match(/^rgba?\((.*)\)$/i)
  if (!match) return undefined
  const body = match[1].trim()
  const slash = body.lastIndexOf('/')
  const channelPart = slash >= 0 ? body.slice(0, slash).trim() : body
  const alphaPart = slash >= 0 ? body.slice(slash + 1).trim() : undefined
  const parts = channelPart.includes(',')
    ? channelPart.split(',').map((part) => part.trim())
    : channelPart.split(/\s+/)
  if (parts.length < 3) return undefined
  const channels = parts.slice(0, 3).map(parseCssChannel)
  if (channels.some((channel) => channel === undefined)) return undefined
  const commaAlpha = parts[3]
  const alpha = alphaPart ? parseCssAlpha(alphaPart) : commaAlpha ? parseCssAlpha(commaAlpha) : 1
  if (alpha === undefined) return undefined
  return {
    channels: channels.map((channel) =>
      Math.max(0, Math.min(255, channel!)),
    ) as ParsedRgb['channels'],
    alpha,
  }
}

export function hexFromRgb(rgb: string): string {
  const parsed = parseRgbFunction(rgb)
  if (!parsed) return rgb
  const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0')
  const [red, green, blue] = parsed.channels
  const base = `#${toHex(red)}${toHex(green)}${toHex(blue)}`
  return parsed.alpha >= 1 ? base : `rgba(${red}, ${green}, ${blue}, ${parsed.alpha})`
}

export function makeColorInfo(observed: string, token?: string): ColorInfo {
  return {
    observed,
    normalized: hexFromRgb(observed),
    token,
    alpha: mAlpha(observed),
  }
}

function mAlpha(value: string): number | undefined {
  return parseRgbFunction(value)?.alpha
}

function opacityOf(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1
}

/** Effective composited opacity includes ancestor stacking contexts. */
export function effectiveOpacityOf(el: HTMLElement): number {
  let opacity = 1
  let node: HTMLElement | null = el
  while (node) {
    opacity *= opacityOf(getComputedStyle(node).opacity)
    node = node.parentElement
  }
  return opacity
}

/** 背景（§14）：颜色 / 渐变 / 图片 */
export function analyzeBackground(el: HTMLElement, cs: CSSStyleDeclaration): BackgroundInfo {
  const image = cs.backgroundImage
  const color = cs.backgroundColor
  const colorInfo =
    color && !isTransparentColor(color)
      ? { color: makeColorInfo(color, extractColorToken(el, color)) }
      : {}
  if (image && image !== 'none') {
    if (image.includes('gradient')) {
      return {
        kind: 'gradient',
        gradient: sanitizeCssValue(image),
        ...colorInfo,
        semanticDescription: 'Gradient surface',
      }
    }
    return {
      kind: 'image',
      imageAssetUid: undefined,
      ...colorInfo,
      semanticDescription: 'Image-based surface',
    }
  }
  if (color && !isTransparentColor(color)) {
    const token = extractColorToken(el, color)
    return {
      kind: 'color',
      color: makeColorInfo(color, token),
      semanticDescription: token ? 'Solid token surface' : 'Solid surface',
    }
  }
  return { kind: 'none' }
}

function isTransparentColor(value: string): boolean {
  return value === 'transparent' || mAlpha(value) === 0
}

/** 从目标及祖先的匹配规则中找颜色 token（§10 / §14） */
export function extractColorToken(el: HTMLElement, observed: string): string | undefined {
  let node: HTMLElement | null = el
  let depth = 0
  while (node && depth < 4) {
    const decls = node.style
    for (let i = 0; i < decls.length; i++) {
      const name = decls[i]
      const value = decls.getPropertyValue(name)
      if (/^var\(--[\w-]+\)$/.test(value.trim())) {
        const varName = value.trim().slice(4, -1)
        if (getComputedStyle(node).getPropertyValue(varName).trim() === observed) return varName
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules) as CSSRule[]) {
          if (rule instanceof CSSStyleRule && node.matches(rule.selectorText)) {
            const v = rule.style.getPropertyValue('background-color').trim()
            const m = v.match(/^var\((--[\w-]+)\)$/)
            if (m && getComputedStyle(node).getPropertyValue(m[1]).trim() === observed) return m[1]
          }
        }
      } catch {
        /* 跨域忽略 */
      }
    }
    node = node.parentElement
    depth += 1
  }
  return undefined
}

/** 边框（§15） */
export function analyzeBorder(el: HTMLElement, cs: CSSStyleDeclaration): BorderInfo | undefined {
  const side = (prefix: 'Top' | 'Right' | 'Bottom' | 'Left') => ({
    width: cs[`border${prefix}Width`],
    style: cs[`border${prefix}Style`],
    color: makeColorInfo(cs[`border${prefix}Color`]),
  })
  const sides = {
    top: side('Top'),
    right: side('Right'),
    bottom: side('Bottom'),
    left: side('Left'),
  }
  if (Object.values(sides).every(({ width, style }) => width === '0px' || style === 'none'))
    return undefined
  return {
    width: sides.top.width,
    style: sides.top.style,
    color: sides.top.color,
    sides,
  }
}

/** 圆角（§15，逐角） */
export function analyzeRadius(cs: CSSStyleDeclaration): RadiusInfo | undefined {
  const r = {
    topLeft: cs.borderTopLeftRadius,
    topRight: cs.borderTopRightRadius,
    bottomRight: cs.borderBottomRightRadius,
    bottomLeft: cs.borderBottomLeftRadius,
  }
  const all = new Set(Object.values(r))
  if (all.size === 1 && all.has('0px')) return undefined
  if (all.size === 1) return { ...r, summary: r.topLeft }
  return r
}

/** 阴影（§15） */
export function analyzeShadows(cs: CSSStyleDeclaration): ShadowInfo[] {
  const value = cs.boxShadow
  if (!value || value === 'none') return []
  return value
    .split(/,(?![^()]*\))/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const inset = part.startsWith('inset')
      const nums = part.replace(/^inset\s*/, '').match(/-?[\d.]+px/g) ?? []
      const [offsetX = '0px', offsetY = '0px', blur = '0px', spread = '0px'] = nums
      const color =
        part
          .replace(/^inset\s*/, '')
          .replace(/-?[\d.]+px/g, '')
          .trim() || '#000'
      return {
        kind: inset ? 'inner' : 'outer',
        offsetX,
        offsetY,
        blur,
        spread,
        color: makeColorInfo(color),
        semanticDescription: inset ? 'Inset shadow' : 'Drop shadow',
      }
    })
}

export function analyzeVisual(el: HTMLElement): VisualProfile {
  const cs = getComputedStyle(el)
  return {
    color: makeColorInfo(cs.color, extractColorToken(el, cs.color)),
    background: analyzeBackground(el, cs),
    border: analyzeBorder(el, cs),
    radius: analyzeRadius(cs),
    shadows: analyzeShadows(cs),
    opacity: cs.opacity !== '1' ? Number.parseFloat(cs.opacity) : undefined,
    effectiveOpacity: effectiveOpacityOf(el),
    transform: cs.transform !== 'none' ? sanitizeCssValue(cs.transform) : undefined,
    transformOrigin: cs.transformOrigin !== '0px 0px' ? cs.transformOrigin : undefined,
    clipPath: cs.clipPath !== 'none' ? sanitizeCssValue(cs.clipPath) : undefined,
    maskImage: cs.maskImage !== 'none' ? sanitizeCssValue(cs.maskImage) : undefined,
    mixBlendMode: cs.mixBlendMode !== 'normal' ? cs.mixBlendMode : undefined,
    isolation: cs.isolation !== 'auto' ? cs.isolation : undefined,
    backdropFilter:
      cs.backdropFilter && cs.backdropFilter !== 'none'
        ? sanitizeCssValue(cs.backdropFilter)
        : undefined,
    filter: cs.filter && cs.filter !== 'none' ? sanitizeCssValue(cs.filter) : undefined,
    pseudoElements: [],
  }
}
