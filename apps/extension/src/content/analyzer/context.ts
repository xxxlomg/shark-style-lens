import type { ComponentInference, ResponsiveProfile } from '../../shared/schemas/style-profile'

const SEMANTIC_KINDS: Record<string, string> = {
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

/** Component Boundary 推断（§6 / §59.3）：信号评分，输出候选而非结论 */
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

/** 外层布局上下文（§6.2）：祖先中最近的布局容器/语义区域（近 → 远） */
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

/** Theme / Responsive 上下文（§21 / §22） */
export function analyzeThemeResponsive(): ResponsiveProfile {
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
  const themeSummary = `${dark ? 'dark' : 'light'} theme, ${surface}${accentToken ? `, ${accentToken} accent` : ''}`

  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    colorScheme: dark ? 'dark' : 'light',
    matchedMediaQueries: matched.slice(0, 8),
    rootFontSize: root.fontSize,
    themeSummary,
  }
}
