import type {
  AssetProfile,
  Inference,
  StyleFact,
  StyleProfile,
  TargetInfo,
} from '../../shared/schemas/style-profile'
import { styleProfileSchema } from '../../shared/schemas/style-profile'
import { collectDom } from './dom'
import { collectComputedFacts } from './css'
import { inspectCssom } from './cssom'
import { analyzeThemeResponsive, collectOuterLayoutContext, inferBoundary } from './context'
import { analyzeLayout } from './layout'
import { analyzePseudoElements } from './pseudo'
import { analyzeTypography } from './typography'
import { uidFor } from './uid'
import { analyzeVisual, extractColorToken } from './visual'
import { sanitizeText } from './privacy'

export const STYLE_PROFILE_VERSION = '0.1.0'

export interface BuildOptions {
  scope: 'element' | 'component'
  onPhase?: (phase: string, progress: number) => void
}

const PHASES: Array<[string, number]> = [
  ['inspecting-structure', 25],
  ['understanding-layout', 50],
  ['collecting-styles', 75],
  ['building-profile', 95],
]

/**
 * 构建 StyleProfile（§23 / §60）：
 * DOM + CSS + Layout + Context 采集 → facts / inferences 分类 → Zod 校验。
 */
export function buildProfile(el: HTMLElement, options: BuildOptions): StyleProfile {
  options.onPhase?.('preparing', 10)

  const targetUid = uidFor(el)
  const rect = el.getBoundingClientRect()

  const target: TargetInfo = {
    uid: targetUid,
    tagName: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? undefined,
    id: el.id || undefined,
    classes: Array.from(el.classList),
    attributes: {},
    textContent: el.childElementCount === 0 ? sanitizeText(el.textContent ?? '') : undefined,
    childCount: el.children.length,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    },
    selector: '',
    isShadowBoundary: el.getRootNode() !== el.ownerDocument,
    insideIframe: Boolean(el.ownerDocument.defaultView && el.ownerDocument.defaultView !== window),
  }

  options.onPhase?.('inspecting-structure', 25)
  const dom = collectDom(el)

  options.onPhase?.('understanding-layout', 50)
  const layout = analyzeLayout(el)
  const typography = analyzeTypography(el)
  const visual = analyzeVisual(el)
  visual.pseudoElements = analyzePseudoElements(el)

  options.onPhase?.('collecting-styles', 75)
  const facts = collectComputedFacts(el, targetUid)
  const cssom = inspectCssom(el, [
    'background-color',
    'color',
    'border-radius',
    'font-family',
    'box-shadow',
    'padding',
  ])

  const boundary = inferBoundary(el)
  const outerLayoutContext = collectOuterLayoutContext(el)
  dom.context.outerLayoutContext = outerLayoutContext
  if (boundary) dom.context.componentBoundary = boundary

  const responsive = analyzeThemeResponsive()

  // 资产（§18）：MVP 只描述不上传资源
  const assets: AssetProfile[] = []
  for (const img of Array.from(el.querySelectorAll('img')).slice(0, 5)) {
    const r = img.getBoundingClientRect()
    assets.push({
      uid: `a-${img.src.length}`,
      kind: 'image',
      hasUrl: Boolean(img.src),
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined,
      aspectRatio:
        img.naturalWidth && img.naturalHeight
          ? `${img.naturalWidth}:${img.naturalHeight}`
          : undefined,
      objectFit: getComputedStyle(img).objectFit,
      objectPosition: getComputedStyle(img).objectPosition,
      description: 'Embedded <img> element',
    })
  }

  options.onPhase?.('building-profile', 95)

  // ---- Facts（观察事实，§60.1） ----
  const mergedFacts = dedupeFacts([
    ...facts,
    ...cssom.rules
      .flatMap((r) => Object.entries(r.properties))
      .filter(([prop]) => !facts.some((f) => f.property === prop))
      .map(([property, value]) => ({
        property,
        value,
        source: 'css-rule' as const,
        confidence: 0.9,
        targetUid,
      })),
  ])

  // ---- Inferences（推断，必须带证据，§60.1） ----
  const inferences: Inference[] = []
  if (boundary) {
    inferences.push({
      type: 'component-type',
      conclusion: `This element appears to be part of a "${boundary.kind}" component`,
      confidence: boundary.confidence,
      reason: boundary.evidence,
    })
  }
  if (typography.semanticRole) {
    inferences.push({
      type: 'semantic-role',
      conclusion: `The text reads as a "${typography.semanticRole}"`,
      confidence: 0.7,
      reason: ['tag semantics and computed font metrics'],
    })
  }
  const accentToken = extractColorToken(
    el,
    visual.background.kind === 'color' ? (visual.background.color?.observed ?? '') : '',
  )
  if (accentToken) {
    inferences.push({
      type: 'theme-token',
      conclusion: `The surface color likely belongs to the design token "${accentToken}"`,
      confidence: 0.7,
      reason: ['resolved custom property matches observed color'],
    })
  }

  const profile: StyleProfile = {
    version: STYLE_PROFILE_VERSION,
    target,
    context: dom.context,
    structure: { domTree: dom.domTree },
    layout: {
      display: layout.display,
      position: layout.position,
      positionContext: layout.positionContext,
      zIndex: layout.zIndex,
      overflow: layout.overflow,
      flex: layout.flex,
      grid: layout.grid,
      semanticDescription: layout.semanticDescription,
    },
    spacing: layout.spacing,
    typography,
    visual,
    assets,
    responsive,
    states: [{ state: 'default', captured: true }],
    facts: mergedFacts,
    inferences,
    warnings: [...dom.warnings, ...cssom.warnings],
  }

  const parsed = styleProfileSchema.safeParse(profile)
  if (!parsed.success) {
    throw new Error(
      `StyleProfile failed validation: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    )
  }
  options.onPhase?.('building-profile', 100)
  return profile
}

/** 按 property+targetUid 去重（后到优先，§59.5） */
function dedupeFacts(facts: StyleFact[]): StyleFact[] {
  const seen = new Map<string, StyleFact>()
  for (const fact of facts) {
    seen.set(`${fact.property}::${fact.targetUid ?? ''}`, fact)
  }
  return Array.from(seen.values())
}
