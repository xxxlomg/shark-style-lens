import type { TypographyProfile } from '../../shared/schemas/style-profile'
import { detectFontSource } from './inheritance'

/** 排版语义角色（§13：不只要数值，还要语义） */
export function inferTypographyRole(el: HTMLElement, cs: CSSStyleDeclaration): string | undefined {
  const tag = el.tagName.toLowerCase()
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return 'primary-heading'
  if (tag === 'caption' || tag === 'figcaption') return 'caption'
  if (['button', 'a', 'input'].includes(tag)) return 'action-label'
  const size = Number.parseFloat(cs.fontSize)
  if (size < 13) return 'caption'
  if (size < 17) return 'body'
  return 'secondary-text'
}

export function analyzeTypography(el: HTMLElement): TypographyProfile {
  const cs = getComputedStyle(el)
  return {
    fontFamily: cs.fontFamily,
    fontFamilySource: detectFontSource(el),
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing !== 'normal' ? cs.letterSpacing : undefined,
    textTransform: cs.textTransform !== 'none' ? cs.textTransform : undefined,
    textDecoration: cs.textDecorationLine !== 'none' ? cs.textDecoration : undefined,
    whiteSpace: cs.whiteSpace,
    wordBreak: cs.wordBreak !== 'normal' ? cs.wordBreak : undefined,
    textAlign: cs.textAlign,
    semanticRole: inferTypographyRole(el, cs),
  }
}
