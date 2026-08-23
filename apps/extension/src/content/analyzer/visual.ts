import type {
  BackgroundInfo,
  BorderInfo,
  ColorInfo,
  RadiusInfo,
  ShadowInfo,
  VisualProfile,
} from '../../shared/schemas/style-profile'

function hexFromRgb(rgb: string): string {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m) return rgb
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  const alpha = m[4] ? Number.parseFloat(m[4]) : 1
  const base = `#${toHex(Number(m[1]))}${toHex(Number(m[2]))}${toHex(Number(m[3]))}`
  return alpha >= 1 ? base : `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`
}

export function makeColorInfo(observed: string, token?: string): ColorInfo {
  return {
    observed,
    normalized: hexFromRgb(observed),
    token,
    alpha: observed.startsWith('rgba')
      ? Number.parseFloat(observed.match(/rgba?\([\d\s,]+([\d.]+)\)/)?.[1] ?? '1')
      : undefined,
  }
}

/** 背景（§14）：颜色 / 渐变 / 图片 */
export function analyzeBackground(el: HTMLElement, cs: CSSStyleDeclaration): BackgroundInfo {
  const image = cs.backgroundImage
  const color = cs.backgroundColor
  if (image && image !== 'none') {
    if (image.includes('gradient')) {
      return { kind: 'gradient', gradient: image, semanticDescription: 'Gradient surface' }
    }
    return { kind: 'image', imageAssetUid: undefined, semanticDescription: 'Image-based surface' }
  }
  if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
    const token = extractColorToken(el, color)
    return {
      kind: 'color',
      color: makeColorInfo(color, token),
      semanticDescription: token ? 'Solid token surface' : 'Solid surface',
    }
  }
  return { kind: 'none' }
}

/** 从目标及祖先的匹配规则中找颜色 token（§10 / §14） */
export function extractColorToken(el: HTMLElement, observed: string): string | undefined {
  let node: HTMLElement | null = el
  let depth = 0
  while (node && depth < 4) {
    const cs = getComputedStyle(node)
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
  const width = cs.borderTopWidth
  if (width === '0px' || (width === 'medium' && cs.borderTopStyle === 'none')) return undefined
  return {
    width,
    style: cs.borderTopStyle,
    color: makeColorInfo(cs.borderTopColor),
  }
}

/** 圆角（§15，逐角） */
export function analyzeRadius(el: HTMLElement, cs: CSSStyleDeclaration): RadiusInfo | undefined {
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
    radius: analyzeRadius(el, cs),
    shadows: analyzeShadows(cs),
    opacity: cs.opacity !== '1' ? Number.parseFloat(cs.opacity) : undefined,
    backdropFilter:
      cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : undefined,
    filter: cs.filter && cs.filter !== 'none' ? cs.filter : undefined,
    pseudoElements: [],
  }
}
