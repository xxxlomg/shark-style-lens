import type { PseudoElementInfo } from '../../shared/schemas/style-profile'
import { sanitizeCssValue, sanitizeText } from './privacy'
import { makeColorInfo } from './visual'

/** 伪元素分析：::before / ::after（icon / 装饰线 / badge / overlay 等） */
export function analyzePseudoElements(el: HTMLElement): PseudoElementInfo[] {
  const out: PseudoElementInfo[] = []
  for (const pseudo of ['::before', '::after'] as const) {
    try {
      const cs = getComputedStyle(el, pseudo)
      const display = cs.display
      if (!display || display === 'none') continue
      const content = cs.content
      const hasContent =
        content !== 'none' && content !== 'normal' && content !== '""' && content !== "''"
      const size = {
        width: cs.width !== 'auto' ? Number.parseFloat(cs.width) : 0,
        height: cs.height !== 'auto' ? Number.parseFloat(cs.height) : 0,
      }
      const background = cs.backgroundImage && cs.backgroundImage !== 'none'
      const hasBackgroundColor =
        cs.backgroundColor &&
        cs.backgroundColor !== 'transparent' &&
        cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      const hasBorder = [
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
      ].some(
        (property) => Number.parseFloat(cs[property as keyof CSSStyleDeclaration] as string) > 0,
      )
      const hasPaint = Boolean(
        background || hasBackgroundColor || hasBorder || (cs.boxShadow && cs.boxShadow !== 'none'),
      )
      if (!hasContent && !hasPaint && size.width <= 0 && size.height <= 0) continue
      const info: PseudoElementInfo = {
        pseudo,
        content:
          content && content !== 'none' && content !== 'normal'
            ? sanitizeText(content.slice(1, -1))
            : undefined,
        display,
        size: size.width > 0 || size.height > 0 ? size : undefined,
        position: cs.position !== 'static' ? cs.position : undefined,
        backgroundSize: cs.backgroundSize !== 'auto' ? cs.backgroundSize : undefined,
        borderRadius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
        boxShadow: cs.boxShadow !== 'none' ? sanitizeCssValue(cs.boxShadow) : undefined,
        transform: cs.transform !== 'none' ? sanitizeCssValue(cs.transform) : undefined,
        clipPath: cs.clipPath !== 'none' ? sanitizeCssValue(cs.clipPath) : undefined,
        opacity: cs.opacity !== '1' ? Number.parseFloat(cs.opacity) : undefined,
        background: background
          ? {
              kind: cs.backgroundImage.includes('gradient') ? 'gradient' : 'image',
              gradient: sanitizeCssValue(cs.backgroundImage),
            }
          : hasBackgroundColor
            ? {
                kind: 'color',
                color: makeColorInfo(cs.backgroundColor),
              }
            : undefined,
        color: cs.color && cs.color !== 'rgba(0, 0, 0, 0)' ? makeColorInfo(cs.color) : undefined,
      }
      info.inferredPurpose = inferPseudoPurpose(info, cs)
      out.push(info)
    } catch {
      /* pseudo 样式读取失败（如 closed shadow）时跳过 */
    }
  }
  return out
}

function inferPseudoPurpose(info: PseudoElementInfo, cs: CSSStyleDeclaration): string | undefined {
  if (info.display === 'block' || info.display === 'inline-block') {
    const h = info.size?.height ?? 0
    const w = info.size?.width ?? 0
    if (h > 0 && h <= 4 && w > 0) return 'decorative-line'
    if (info.background?.kind === 'gradient' && h > 4) return 'overlay'
    if (w > 0 && w <= 40 && h > 0 && h <= 40) return 'badge'
  }
  if (info.content) {
    if (/^[^\w\s]$/.test(info.content)) return 'icon'
    if (info.content.length <= 4) return 'badge'
    return 'label'
  }
  void cs
  return undefined
}
