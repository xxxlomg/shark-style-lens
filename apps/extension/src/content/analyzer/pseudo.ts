import type { PseudoElementInfo } from '../../shared/schemas/style-profile'

/** 伪元素分析（§16）：::before / ::after（icon / 装饰线 / badge / overlay 等） */
export function analyzePseudoElements(el: HTMLElement): PseudoElementInfo[] {
  const out: PseudoElementInfo[] = []
  for (const pseudo of ['::before', '::after'] as const) {
    try {
      const cs = getComputedStyle(el, pseudo)
      const display = cs.display
      if (!display || display === 'none') continue
      const content = cs.content
      const size = {
        width: cs.width !== 'auto' ? Number.parseFloat(cs.width) : 0,
        height: cs.height !== 'auto' ? Number.parseFloat(cs.height) : 0,
      }
      const background = cs.backgroundImage && cs.backgroundImage !== 'none'
      const info: PseudoElementInfo = {
        pseudo,
        content:
          content && content !== 'none' && content !== 'normal' ? content.slice(1, -1) : undefined,
        display,
        size: size.width > 0 || size.height > 0 ? size : undefined,
        background: background
          ? {
              kind: cs.backgroundImage.includes('gradient') ? 'gradient' : 'image',
              gradient: cs.backgroundImage,
            }
          : undefined,
        color:
          cs.color && cs.color !== 'rgba(0, 0, 0, 0)'
            ? { observed: cs.color, normalized: cs.color }
            : undefined,
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
