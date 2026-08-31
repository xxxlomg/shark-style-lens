import type { StyleFact } from '../../shared/schemas/style-profile'
import { sanitizeCssValue } from './privacy'
import { uidFor } from './uid'

/** 高价值属性清单（§8.1 / §59.5：collect → rank；显式 none/0 也保留）。 */
export const KEY_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'column-gap',
  'row-gap',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'white-space',
  'word-break',
  'color',
  'background-color',
  'background-image',
  'background-size',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'opacity',
  'transform',
  'transform-origin',
  'clip-path',
  'mask-image',
  'mix-blend-mode',
  'will-change',
  'isolation',
  'contain',
  'overflow',
  'overflow-x',
  'overflow-y',
  'z-index',
  'visibility',
  'pointer-events',
  'box-sizing',
  'backdrop-filter',
  'filter',
] as const

export const DEFAULT_CSS_PROPS = new Set(['box-sizing', 'visibility', 'pointer-events', 'overflow'])

const KEEP_NEUTRAL_PROPS = new Set([
  'opacity',
  'visibility',
  'pointer-events',
  'box-sizing',
  'overflow',
])

/** 提取目标元素的高价值 computed 属性（§8.1） */
export function extractComputedStyles(el: HTMLElement): Record<string, string> {
  const cs = getComputedStyle(el)
  const out: Record<string, string> = {}
  for (const prop of KEY_PROPS) {
    const value = cs.getPropertyValue(prop)
    if (value && (value !== 'normal' || KEEP_NEUTRAL_PROPS.has(prop))) {
      out[prop] = sanitizeCssValue(value)
    }
  }
  return out
}

/** 生成 facts（source: computed，§60.1） */
export function collectComputedFacts(el: HTMLElement, targetUid: string): StyleFact[] {
  const cs = getComputedStyle(el)
  const facts: StyleFact[] = []
  for (const prop of KEY_PROPS) {
    const value = cs.getPropertyValue(prop)
    if (
      !value ||
      (value === 'normal' && !KEEP_NEUTRAL_PROPS.has(prop)) ||
      ((value === 'none' || value === 'auto' || value === '0px') && !KEEP_NEUTRAL_PROPS.has(prop))
    ) {
      continue
    }
    facts.push({
      property: prop,
      value: sanitizeCssValue(value),
      source: 'computed',
      confidence: 1,
      targetUid,
    })
  }
  void uidFor
  return facts
}
