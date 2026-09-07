import type {
  ComponentInference,
  PageContext,
  ResponsiveProfile,
} from '../../shared/schemas/style-profile'

const SEMANTIC_KINDS: Record<string, string> = {
  button: 'button',
  fieldset: 'fieldset',
  label: 'label',
  li: 'list-item',
  article: 'article',
  section: 'section',
  nav: 'navigation',
  form: 'form',
  dialog: 'dialog',
  header: 'header',
  footer: 'footer',
  main: 'main',
  aside: 'aside',
}

const CLASS_HINTS: Array<[RegExp, string]> = [
  [/card/i, 'card'],
  [/panel|widget|box/i, 'panel'],
  [/navbar|header|nav/i, 'navbar'],
  [/toolbar|bar/i, 'toolbar'],
  [/modal|dialog|popover/i, 'modal'],
  [/form/i, 'form'],
  [/composer|input|editor|surface/i, 'input-composer'],
  [/badge|pill|chip|tag/i, 'badge'],
  [/list|menu/i, 'list'],
  [/hero|banner/i, 'hero'],
]

interface BoundaryCandidate {
  el: HTMLElement
  kind: string
  score: number
  evidence: string[]
}

export interface ComponentRootResolution {
  root: HTMLElement
  kind: string
  confidence: number
  evidence: string[]
  distance: number
}

interface RootCandidate extends BoundaryCandidate {
  distance: number
}

function isOpaque(value: string): boolean {
  return !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
}

function interactiveDescendantCount(el: HTMLElement): number {
  const descendants = el.querySelectorAll(
    'button, input, textarea, select, a[href], [role="button"], [role="combobox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
  ).length
  const self = el.matches(
    'button, input, textarea, select, a[href], [role="button"], [role="combobox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
  )
    ? 1
    : 0
  return descendants + self
}

function areaOf(el: HTMLElement): number {
  const rect = el.getBoundingClientRect()
  return Math.max(0, rect.width) * Math.max(0, rect.height)
}

function rootPenalty(
  node: HTMLElement,
  selectedArea: number,
): { value: number; evidence: string[] } {
  const rect = node.getBoundingClientRect()
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)
  const ratio = areaOf(node) / viewportArea
  const expansion = selectedArea > 0 ? areaOf(node) / selectedArea : 1
  const evidence: string[] = []
  let value = 0

  // A component root should not silently expand to a page section or shell.
  if (ratio > 0.85) {
    value += 6
    evidence.push('page-scale-area-penalty')
  } else if (ratio > 0.65) {
    value += 3
    evidence.push('large-area-penalty')
  }
  if (expansion > 120) {
    value += 3
    evidence.push('excessive-selection-expansion')
  } else if (expansion > 60) {
    value += 1
    evidence.push('wide-selection-expansion')
  }
  if (rect.width >= window.innerWidth * 0.9 || rect.height >= window.innerHeight * 0.9) {
    value += 2
    evidence.push('viewport-spanning-penalty')
  }
  return { value, evidence }
}

function scoreComponentRoot(node: HTMLElement): {
  value: number
  evidence: string[]
  kind: string
} {
  const cs = getComputedStyle(node)
  const evidence: string[] = []
  let value = 0
  const tag = node.tagName.toLowerCase()

  if (!isOpaque(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none')) {
    value += 2
    evidence.push('visual-enclosure')
  }
  if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') {
    value += 2
    evidence.push('border-enclosure')
  }
  if ([cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].some((v) => v !== '0px')) {
    value += 1
    evidence.push('padding-container')
  }
  if (cs.borderTopLeftRadius !== '0px') {
    value += 1
    evidence.push('rounded-surface')
  }
  if (cs.display === 'flex' || cs.display === 'grid') {
    value += 2
    evidence.push('layout-container')
  }
  if (node.children.length >= 2) {
    value += 1
    evidence.push('multiple-children')
  }
  const controls = interactiveDescendantCount(node)
  if (controls >= 2) {
    value += 2
    evidence.push(`interactive-descendants:${controls}`)
  } else if (controls === 1) {
    value += 1
    evidence.push('interactive-descendant')
  }
  if (SEMANTIC_KINDS[tag]) {
    value += 2
    evidence.push(`semantic-tag:${tag}`)
  }

  let kind = SEMANTIC_KINDS[tag] ?? (tag === 'div' ? 'container' : tag)
  for (const [re, hintedKind] of CLASS_HINTS) {
    if (Array.from(node.classList).some((className) => re.test(className))) {
      value += 2
      evidence.push(`class-hint:${hintedKind}`)
      kind = hintedKind
      break
    }
  }
  return { value, evidence, kind }
}

/** Resolve a bounded, evidence-backed component root for component scope. */
export function resolveComponentRoot(el: HTMLElement, maxDepth = 6): ComponentRootResolution {
  const candidates: RootCandidate[] = []
  let node: HTMLElement | null = el
  let distance = 0
  const selectedArea = areaOf(el)

  while (node && node !== document.body && distance <= maxDepth) {
    const scored = scoreComponentRoot(node)
    const descendantControls = interactiveDescendantCount(node)
    const compositeShape =
      distance > 0 ||
      node.children.length >= 2 ||
      descendantControls >= 2 ||
      Boolean(SEMANTIC_KINDS[node.tagName.toLowerCase()])
    const penalty = rootPenalty(node, selectedArea)
    const tag = node.tagName.toLowerCase()
    const semanticPenalty = tag === 'main' || tag === 'section' ? 1 : 0
    const score = scored.value - penalty.value - semanticPenalty - distance * 0.25
    if (scored.value >= 4 && compositeShape && penalty.value < 6) {
      candidates.push({
        ...scored,
        el: node,
        score,
        distance,
        evidence: [
          ...scored.evidence,
          ...penalty.evidence,
          ...(semanticPenalty ? ['page-region-penalty'] : []),
        ],
      })
    }
    node = node.parentElement
    distance += 1
  }

  const best = candidates.sort((a, b) => b.score - a.score || a.distance - b.distance)[0]
  if (!best) {
    return {
      root: el,
      kind: el.tagName.toLowerCase(),
      confidence: 0.35,
      evidence: ['selected-element-fallback'],
      distance: 0,
    }
  }

  return {
    root: best.el,
    kind: best.kind,
    confidence: Math.max(0.35, Math.min(0.98, 0.48 + best.score * 0.07 - best.distance * 0.01)),
    evidence: best.evidence,
    distance: best.distance,
  }
}

/** Component Boundary 推断：信号评分，输出候选而非结论 */
export function inferBoundary(el: HTMLElement, maxDepth = 4): ComponentInference | undefined {
  const candidates: BoundaryCandidate[] = []
  let node: HTMLElement | null = el.parentElement
  let depth = 0

  while (node && node !== document.body && depth < maxDepth) {
    const cs = getComputedStyle(node)
    const score: { v: number; evidence: string[] } = { v: 0, evidence: [] }

    // 视觉包围：背景 / 边框 / 圆角
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      score.v += 2
      score.evidence.push('visual-enclosure')
    }
    if (cs.borderTopWidth !== '0px') {
      score.v += 1
      score.evidence.push('border-enclosure')
    }
    if (cs.borderTopLeftRadius !== '0px') {
      score.v += 1
      score.evidence.push('rounded-surface')
    }
    // padding 容器
    if (cs.paddingTop !== '0px') {
      score.v += 1
      score.evidence.push('padding-container')
    }
    // flex/grid 容器
    if (cs.display === 'flex' || cs.display === 'grid') {
      score.v += 1
      score.evidence.push('layout-container')
    }
    // 兄弟重复（列表/卡片组）
    const siblings = node.parentElement
      ? Array.from(node.parentElement.children).filter((s) => s.tagName === node!.tagName)
      : []
    if (siblings.length >= 3) {
      score.v += 1
      score.evidence.push('sibling-repetition')
    }
    // 语义标签
    const tag = node.tagName.toLowerCase()
    const semantic = SEMANTIC_KINDS[tag]
    if (semantic) {
      score.v += 3
      score.evidence.push(`semantic-tag:${tag}`)
    }
    // class 命名提示
    for (const [re, kind] of CLASS_HINTS) {
      if (Array.from(node.classList).some((c) => re.test(c))) {
        score.v += 2
        score.evidence.push(`class-hint:${kind}`)
      }
    }
    // aria / role
    const role = node.getAttribute('role')
    if (role) {
      score.v += 2
      score.evidence.push(`role:${role}`)
    }

    if (score.v >= 3) {
      const kind =
        SEMANTIC_KINDS[tag] ??
        CLASS_HINTS.find(([re]) => Array.from(node!.classList).some((c) => re.test(c)))?.[1] ??
        (tag === 'div' ? 'container' : tag)
      candidates.push({ el: node, kind, score: score.v, evidence: score.evidence })
    }

    node = node.parentElement
    depth += 1
  }

  if (candidates.length === 0) return undefined
  const best = candidates.sort((a, b) => b.score - a.score)[0]
  return {
    kind: best.kind,
    confidence: Math.min(0.95, 0.5 + best.score * 0.1),
    evidence: best.evidence,
  }
}

/** 外层布局上下文：祖先中最近的布局容器/语义区域（近 → 远） */
export function collectOuterLayoutContext(el: HTMLElement, max = 3): string[] {
  const out: string[] = []
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body && out.length < max) {
    const cs = getComputedStyle(node)
    const tag = node.tagName.toLowerCase()
    if (cs.display === 'flex' || cs.display === 'grid') out.push(tag)
    else if (SEMANTIC_KINDS[tag]) out.push(tag)
    node = node.parentElement
  }
  return out
}

/** Theme / Responsive 上下文；page 为 T2 页面主题检测结果，优先于 prefers-color-scheme */
export function analyzeThemeResponsive(page?: PageContext): ResponsiveProfile {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const root = getComputedStyle(document.documentElement)
  const body = getComputedStyle(document.body)

  const matched: string[] = []
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules) as CSSRule[]) {
          if (
            rule instanceof CSSMediaRule &&
            rule.media.mediaText &&
            window.matchMedia(rule.media.mediaText).matches
          ) {
            if (!matched.includes(rule.media.mediaText)) matched.push(rule.media.mediaText)
          }
        }
      } catch {
        /* 跨域忽略 */
      }
    }
  } catch {
    /* ignore */
  }

  // accent token 猜测：root 变量中常见主色命名
  let accentToken: string | undefined
  for (const name of [
    '--color-primary',
    '--brand',
    '--accent',
    '--primary-color',
    '--color-brand',
  ]) {
    const v = root.getPropertyValue(name).trim()
    if (v) {
      accentToken = name
      break
    }
  }
  const surface =
    body.backgroundColor && body.backgroundColor !== 'rgba(0, 0, 0, 0)'
      ? 'colored surface'
      : 'neutral surface'
  const scheme = page?.scheme && page.scheme !== 'unknown' ? page.scheme : dark ? 'dark' : 'light'
  const surfaceDesc = page?.pageBackground ? `page background ${page.pageBackground}` : surface
  const themeSummary = `${scheme} theme, ${surfaceDesc}${accentToken ? `, ${accentToken} accent` : ''}`

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    colorScheme: dark ? 'dark' : 'light',
    matchedMediaQueries: matched.slice(0, 8),
    rootFontSize: root.fontSize,
    themeSummary,
  }
}
