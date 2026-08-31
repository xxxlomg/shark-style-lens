import type { SubtreeNode, SubtreeRole, SubtreeState } from '../../shared/schemas/style-profile'
import { analyzePseudoElements } from './pseudo'
import { sanitizeAttributes, sanitizeCssValue, sanitizeText } from './privacy'
import { uidFor } from './uid'
import { effectiveOpacityOf } from './visual'

// 限深限宽（性能/体积预算）：复杂页面只保留最有价值的子结构
export const SUBTREE_MAX_DEPTH = 5
export const SUBTREE_MAX_NODES = 96

const MAX_VALUE_LEN = 120

const BADGE_RE = /badge|pill|chip|tag/i
const ICON_RE = /icon/i
const TOOLBAR_RE = /toolbar|actions?|controls?/i
const DIVIDER_RE = /divider|separator/i
const DROPDOWN_RE = /select|dropdown|menu-item|combobox/i
const SEND_RE = /send|submit|continue|go/i
const OPTIMIZE_RE = /optim|enhance|improve|magic/i

const SUBTREE_STYLE_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'min-width',
  'max-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'column-gap',
  'row-gap',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-decoration',
  'white-space',
  'word-break',
  'color',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'background-clip',
  'background-blend-mode',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-right-width',
  'border-right-style',
  'border-right-color',
  'border-bottom-width',
  'border-bottom-style',
  'border-bottom-color',
  'border-left-width',
  'border-left-style',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'opacity',
  'filter',
  'backdrop-filter',
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
  'pointer-events',
] as const

export interface SubtreeColor {
  value: string
  usage: 'background' | 'text' | 'border'
}

export interface SubtreeCollection {
  tree: SubtreeNode[]
  truncated: boolean
  colors: SubtreeColor[]
}

interface WalkState {
  count: number
  truncated: boolean
}

function isVisible(cs: CSSStyleDeclaration, rect: DOMRect): boolean {
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') {
    return false
  }
  if (cs.display === 'contents') return true
  return rect.width > 0 || rect.height > 0
}

function opacityOf(cs: CSSStyleDeclaration): number {
  const value = Number.parseFloat(cs.opacity)
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
}

function visibilityState(effectiveOpacity: number): 'visible' | 'opacity-zero' {
  return effectiveOpacity === 0 ? 'opacity-zero' : 'visible'
}

function hasClassMatching(el: HTMLElement, re: RegExp): boolean {
  return Array.from(el.classList).some((c) => re.test(c))
}

/** roleGuess 启发式：仅作为 prompt 提示（inference 性质），不作为 facts */
function guessRole(el: HTMLElement, _cs: CSSStyleDeclaration, isLeaf: boolean): SubtreeRole {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role') ?? ''
  if (
    tag === 'select' ||
    ['combobox', 'listbox', 'menuitem', 'option', 'switch', 'checkbox', 'radio'].includes(role)
  )
    return 'control'
  if (tag === 'input' || tag === 'textarea' || role === 'textbox') {
    return 'input'
  }
  if (tag === 'button' || role === 'button') {
    return 'button'
  }
  if (tag === 'a' && el.hasAttribute('href')) return 'link'
  if (tag === 'svg' || tag === 'img' || tag === 'canvas' || hasClassMatching(el, ICON_RE)) {
    return tag === 'img' ? 'image' : 'icon'
  }
  if (hasClassMatching(el, DIVIDER_RE)) return 'divider'
  if (hasClassMatching(el, TOOLBAR_RE)) return 'toolbar'
  if (hasClassMatching(el, BADGE_RE)) return 'badge'
  if (isLeaf && (el.textContent ?? '').trim()) return 'text'
  return 'container'
}

function isInteractive(el: HTMLElement, roleGuess: SubtreeRole): boolean {
  return (
    roleGuess === 'button' ||
    roleGuess === 'input' ||
    roleGuess === 'control' ||
    roleGuess === 'link' ||
    el.isContentEditable ||
    (el.hasAttribute('tabindex') && el.tabIndex >= 0)
  )
}

function actionHint(el: HTMLElement, roleGuess: SubtreeRole): string | undefined {
  if (!isInteractive(el, roleGuess)) return undefined
  const classes = Array.from(el.classList).join(' ')
  const label = `${classes} ${el.getAttribute('type') ?? ''}`
  if (SEND_RE.test(label)) return 'likely submit/send action (inferred from control naming)'
  if (OPTIMIZE_RE.test(label))
    return 'likely prompt optimization action (inferred from control naming)'
  if (DROPDOWN_RE.test(label) || el.getAttribute('aria-haspopup') === 'listbox') {
    return 'likely dropdown or menu trigger (inferred from control semantics)'
  }
  if (roleGuess === 'input') return 'text entry control'
  return 'interactive control'
}

function stateOf(el: HTMLElement): SubtreeState | undefined {
  const state: SubtreeState = {}
  if ('disabled' in el && Boolean((el as HTMLButtonElement | HTMLInputElement).disabled))
    state.disabled = true
  if (el.getAttribute('aria-disabled') === 'true') state.disabled = true
  for (const [attribute, key] of [
    ['aria-expanded', 'expanded'],
    ['aria-selected', 'selected'],
    ['aria-checked', 'checked'],
    ['aria-pressed', 'pressed'],
  ] as const) {
    const value = el.getAttribute(attribute)
    if (value !== null) state[key] = value === 'true'
  }
  if ('checked' in el) state.checked = Boolean((el as HTMLInputElement).checked)
  if ('indeterminate' in el) state.indeterminate = Boolean((el as HTMLInputElement).indeterminate)
  if ('selected' in el) state.selected = Boolean((el as HTMLOptionElement).selected)
  const current = el.getAttribute('aria-current')
  if (current && current !== 'false') state.current = current === 'true' ? 'true' : current
  return Object.keys(state).length > 0 ? state : undefined
}

function layoutLine(cs: CSSStyleDeclaration): string | undefined {
  const display = cs.display
  if (display === 'flex' || display === 'inline-flex') {
    const parts = [`flex ${cs.flexDirection}`]
    if (cs.justifyContent !== 'normal') parts.push(`justify ${cs.justifyContent}`)
    if (cs.alignItems !== 'normal') parts.push(`align ${cs.alignItems}`)
    if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') parts.push(`gap ${cs.gap}`)
    return parts.join(', ')
  }
  if (display === 'grid' || display === 'inline-grid') {
    const gap = cs.gap && cs.gap !== 'normal' && cs.gap !== '0px' ? `, gap ${cs.gap}` : ''
    return `grid, columns ${cs.gridTemplateColumns}${gap}`
  }
  return undefined
}

function backgroundOf(cs: CSSStyleDeclaration): string | undefined {
  const image = cs.backgroundImage
  if (image && image !== 'none') {
    const safeImage = sanitizeCssValue(image)
    return safeImage.length > MAX_VALUE_LEN ? `${safeImage.slice(0, MAX_VALUE_LEN)}…` : safeImage
  }
  const color = cs.backgroundColor
  if (color && !isTransparentColor(color)) return color
  return undefined
}

function isTransparentColor(value: string): boolean {
  return (
    value === 'transparent' || /rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\s*(?:[,/]\s*0\s*)?\)/i.test(value)
  )
}

function borderOf(cs: CSSStyleDeclaration): string | undefined {
  const sides = [
    ['top', cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor],
    ['right', cs.borderRightWidth, cs.borderRightStyle, cs.borderRightColor],
    ['bottom', cs.borderBottomWidth, cs.borderBottomStyle, cs.borderBottomColor],
    ['left', cs.borderLeftWidth, cs.borderLeftStyle, cs.borderLeftColor],
  ] as const
  const painted = sides.filter(([, width, style]) => width !== '0px' && style !== 'none')
  if (painted.length === 0) return undefined
  const first = painted[0]
  if (
    painted.every(
      ([, width, style, color]) => width === first[1] && style === first[2] && color === first[3],
    )
  ) {
    return `${first[1]} ${first[2]} ${first[3]}`
  }
  return painted
    .map(([side, width, style, color]) => `${side}: ${width} ${style} ${color}`)
    .join('; ')
}

function radiusOf(cs: CSSStyleDeclaration): string | undefined {
  const corners = [
    cs.borderTopLeftRadius,
    cs.borderTopRightRadius,
    cs.borderBottomRightRadius,
    cs.borderBottomLeftRadius,
  ]
  if (corners.every((c) => c === '0px')) return undefined
  if (corners.every((c) => c === corners[0])) return corners[0]
  return corners.join(' ')
}

function shadowOf(cs: CSSStyleDeclaration): string | undefined {
  if (!cs.boxShadow || cs.boxShadow === 'none') return undefined
  return cs.boxShadow.length > MAX_VALUE_LEN
    ? `${cs.boxShadow.slice(0, MAX_VALUE_LEN)}…`
    : cs.boxShadow
}

function truncate(value: string): string {
  return value.length > MAX_VALUE_LEN ? `${value.slice(0, MAX_VALUE_LEN)}…` : value
}

function computedOf(cs: CSSStyleDeclaration): Record<string, string> {
  const out: Record<string, string> = {}
  for (const property of SUBTREE_STYLE_PROPS) {
    const value = cs.getPropertyValue(property).trim()
    if (value) out[property] = truncate(sanitizeCssValue(value))
  }
  return out
}

function controlOf(el: HTMLElement, roleGuess: SubtreeRole): SubtreeNode['control'] {
  const tag = el.tagName.toLowerCase()
  const isControl =
    roleGuess === 'button' ||
    roleGuess === 'input' ||
    roleGuess === 'control' ||
    el.isContentEditable
  if (!isControl) return undefined

  const valuePresent =
    'value' in el
      ? String((el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value ?? '')
          .length > 0
      : el.isContentEditable
        ? Boolean((el.textContent ?? '').trim())
        : undefined

  return {
    kind: tag === 'input' ? 'input' : tag === 'textarea' ? 'textarea' : tag,
    type: tag === 'input' ? (el.getAttribute('type') ?? 'text') : undefined,
    placeholder: el.getAttribute('placeholder')
      ? sanitizeText(el.getAttribute('placeholder') ?? '')
      : undefined,
    title: el.getAttribute('title') ? sanitizeText(el.getAttribute('title') ?? '') : undefined,
    valuePresent,
  }
}

/**
 * 子树深度解析（保真度提升 T1）：
 * 递归采集目标后代的紧凑样式摘要（嵌套 children 树），
 * 同时收集颜色样本供页面调色板聚合（T2）。
 */
export function collectSubtree(el: HTMLElement): SubtreeCollection {
  const state: WalkState = { count: 0, truncated: false }
  const colors: SubtreeColor[] = []
  const targetRect = el.getBoundingClientRect()
  const root = nodeOf(
    el,
    0,
    state,
    colors,
    targetRect,
    undefined,
    undefined,
    effectiveOpacityOf(el.parentElement ?? el),
  )
  const tree = root ? [root] : []
  return { tree, truncated: state.truncated, colors }
}

function walkChildren(
  parent: HTMLElement,
  depth: number,
  state: WalkState,
  colors: SubtreeColor[],
  targetRect: DOMRect,
  ancestorOpacity = 1,
): SubtreeNode[] {
  const out: SubtreeNode[] = []
  for (const [childIndex, child] of (Array.from(parent.children) as HTMLElement[]).entries()) {
    if (state.count >= SUBTREE_MAX_NODES) {
      state.truncated = true
      break
    }
    const node = nodeOf(
      child,
      depth,
      state,
      colors,
      targetRect,
      uidFor(parent),
      childIndex,
      ancestorOpacity,
    )
    if (node) out.push(node)
  }
  return out
}

function nodeOf(
  el: HTMLElement,
  depth: number,
  state: WalkState,
  colors: SubtreeColor[],
  targetRect: DOMRect,
  parentUid?: string,
  childIndex?: number,
  ancestorOpacity = 1,
): SubtreeNode | null {
  const cs = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  if (!isVisible(cs, rect)) return null
  state.count += 1
  const effectiveOpacity = ancestorOpacity * opacityOf(cs)

  const isLeaf = el.childElementCount === 0
  const roleGuess = guessRole(el, cs, isLeaf)

  const background = backgroundOf(cs)
  const border = borderOf(cs)
  const color = roleGuess === 'container' ? undefined : cs.color
  if (
    cs.backgroundColor &&
    cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    cs.backgroundColor !== 'transparent'
  ) {
    colors.push({ value: cs.backgroundColor, usage: 'background' })
  }
  if (color) colors.push({ value: color, usage: 'text' })
  if (border) {
    for (const colorValue of [
      cs.borderTopColor,
      cs.borderRightColor,
      cs.borderBottomColor,
      cs.borderLeftColor,
    ]) {
      colors.push({ value: colorValue, usage: 'border' })
    }
  }

  const withText =
    roleGuess === 'text' ||
    roleGuess === 'button' ||
    roleGuess === 'badge' ||
    roleGuess === 'control' ||
    roleGuess === 'link'
  const interactive = isInteractive(el, roleGuess)
  const node: SubtreeNode = {
    uid: uidFor(el),
    parentUid,
    childIndex,
    depth,
    tagName: el.tagName.toLowerCase(),
    roleGuess,
    semanticRole: el.getAttribute('role') ?? undefined,
    interactive,
    visibilityState: visibilityState(effectiveOpacity),
    effectiveOpacity: effectiveOpacity !== 1 ? effectiveOpacity : undefined,
    actionHint: actionHint(el, roleGuess),
    state: stateOf(el),
    attributes: sanitizeAttributes(
      Object.fromEntries(
        Array.from(el.attributes).map((attribute) => [attribute.name, attribute.value]),
      ),
    ),
    control: controlOf(el, roleGuess),
    rect: {
      x: rect.x - targetRect.x,
      y: rect.y - targetRect.y,
      width: rect.width,
      height: rect.height,
    },
    computed: computedOf(cs),
    layout: layoutLine(cs),
    background,
    color,
    border,
    radius: radiusOf(cs),
    shadow: shadowOf(cs),
    typography: withText
      ? { fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight }
      : undefined,
    pseudoElements: analyzePseudoElements(el),
    textContent:
      withText && (el.textContent ?? '').trim() ? sanitizeText(el.textContent ?? '') : undefined,
    children: [],
  }

  if (depth < SUBTREE_MAX_DEPTH && state.count < SUBTREE_MAX_NODES) {
    node.children = walkChildren(el, depth + 1, state, colors, targetRect, effectiveOpacity)
  } else if (el.children.length > 0) {
    state.truncated = true
  }

  // 去掉无意义的空 background-image 等：truncate 保护已在取值处完成
  if (node.background) node.background = truncate(node.background)
  return node
}
