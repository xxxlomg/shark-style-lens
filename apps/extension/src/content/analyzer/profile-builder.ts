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
import {
  analyzeThemeResponsive,
  collectOuterLayoutContext,
  inferBoundary,
  resolveComponentRoot,
} from './context'
import { analyzeLayout } from './layout'
import { analyzePseudoElements } from './pseudo'
import { collectSubtree, SUBTREE_MAX_NODES, type SubtreeColor } from './subtree'
import { analyzePageContext } from './theme'
import { analyzeTypography } from './typography'
import { uidFor } from './uid'
import { analyzeVisual, extractColorToken } from './visual'
import { sanitizeAttributes, sanitizeText } from './privacy'
import { collectInteractionEvidence } from './interaction'

export const STYLE_PROFILE_VERSION = '0.1.0'

const UI_STATES = [
  'hover',
  'focus',
  'active',
  'disabled',
  'checked',
  'selected',
  'expanded',
  'pressed',
] as const

const CSSOM_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'padding',
  'margin',
  'gap',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'grid-template-columns',
  'grid-template-rows',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'background-clip',
  'background-blend-mode',
  'border-radius',
  'border-width',
  'border-style',
  'border-color',
  'outline',
  'outline-offset',
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
  'z-index',
] as const

export interface BuildOptions {
  scope: 'element' | 'component'
  onPhase?: (phase: string, progress: number) => void
}

/**
 * 构建 StyleProfile：
 * DOM + CSS + Layout + Context 采集 → facts / inferences 分类 → Zod 校验。
 */
export async function buildProfile(el: HTMLElement, options: BuildOptions): Promise<StyleProfile> {
  options.onPhase?.('preparing', 10)

  const selectedUid = uidFor(el)
  const componentRoot = options.scope === 'component' ? resolveComponentRoot(el) : undefined
  const analysisRoot = componentRoot?.root ?? el
  const targetUid = uidFor(analysisRoot)
  const rect = analysisRoot.getBoundingClientRect()
  const targetAttributes: Record<string, string> = {}
  for (const attribute of analysisRoot.attributes) {
    targetAttributes[attribute.name] = attribute.value
  }

  const target: TargetInfo = {
    uid: targetUid,
    selectedUid: selectedUid !== targetUid ? selectedUid : undefined,
    tagName: analysisRoot.tagName.toLowerCase(),
    role: analysisRoot.getAttribute('role') ?? undefined,
    id: analysisRoot.id || undefined,
    classes: Array.from(analysisRoot.classList),
    attributes: sanitizeAttributes(targetAttributes),
    textContent:
      analysisRoot.childElementCount === 0
        ? sanitizeText(analysisRoot.textContent ?? '')
        : undefined,
    childCount: analysisRoot.children.length,
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
    isShadowBoundary: analysisRoot.getRootNode() !== analysisRoot.ownerDocument,
    insideIframe: Boolean(
      analysisRoot.ownerDocument.defaultView && analysisRoot.ownerDocument.defaultView !== window,
    ),
  }

  options.onPhase?.('inspecting-structure', 25)
  const dom = collectDom(analysisRoot)

  options.onPhase?.('understanding-layout', 50)
  const layout = analyzeLayout(analysisRoot)
  const typography = analyzeTypography(analysisRoot)
  const visual = analyzeVisual(analysisRoot)
  visual.pseudoElements = analyzePseudoElements(analysisRoot)

  options.onPhase?.('collecting-styles', 75)
  const facts = collectComputedFacts(analysisRoot, targetUid)
  const subtree = collectSubtree(analysisRoot)

  // 页面主题与调色板（T2）：目标自身颜色 + 子树颜色样本
  const targetColors: SubtreeColor[] = []
  if (visual.background.kind === 'color' && visual.background.color) {
    targetColors.push({ value: visual.background.color.observed, usage: 'background' })
  }
  targetColors.push({ value: visual.color.observed, usage: 'text' })
  if (visual.border) targetColors.push({ value: visual.border.color.observed, usage: 'border' })
  const pageContext = analyzePageContext([...targetColors, ...subtree.colors])
  const cssom = inspectCssom(analysisRoot, [...CSSOM_PROPS])

  options.onPhase?.('observing-interactions', 88)
  const interactions = await collectInteractionEvidence(analysisRoot)

  const boundary = componentRoot
    ? {
        kind: componentRoot.kind,
        confidence: componentRoot.confidence,
        evidence: componentRoot.evidence,
        rootUid: targetUid,
        rootTagName: analysisRoot.tagName.toLowerCase(),
        rootClasses: Array.from(analysisRoot.classList),
      }
    : inferBoundary(el)
  const outerLayoutContext = collectOuterLayoutContext(analysisRoot)
  dom.context.outerLayoutContext = outerLayoutContext
  if (boundary) dom.context.componentBoundary = boundary

  const responsive = analyzeThemeResponsive(pageContext)

  // 资产只描述渲染来源，不上传 URL 或资源内容。
  const assets: AssetProfile[] = []
  const assetElements = [
    ...(analysisRoot.matches('img,svg,canvas,video') ? [analysisRoot] : []),
    ...Array.from(analysisRoot.querySelectorAll('img,svg,canvas,video')),
  ].slice(0, 12) as HTMLElement[]
  for (const element of assetElements) {
    const tag = element.tagName.toLowerCase()
    const rect = element.getBoundingClientRect()
    const image = element instanceof HTMLImageElement ? element : undefined
    const svg = element instanceof SVGElement ? element : undefined
    assets.push({
      uid: `a-${uidFor(element)}`,
      kind:
        tag === 'svg'
          ? 'svg'
          : tag === 'canvas'
            ? 'icon'
            : tag === 'video'
              ? 'video-thumbnail'
              : 'image',
      hasUrl:
        tag === 'img'
          ? Boolean(image?.currentSrc || image?.src)
          : tag === 'video'
            ? Boolean((element as HTMLVideoElement).poster)
            : false,
      width: image?.naturalWidth || rect.width || undefined,
      height: image?.naturalHeight || rect.height || undefined,
      aspectRatio: rect.width && rect.height ? `${rect.width}:${rect.height}` : undefined,
      objectFit: getComputedStyle(element).objectFit,
      objectPosition: getComputedStyle(element).objectPosition,
      svgViewBox: svg?.getAttribute('viewBox') ?? undefined,
      description: `Embedded <${tag}> render source`,
    })
  }
  const rootBackground = getComputedStyle(analysisRoot).backgroundImage
  if (rootBackground && rootBackground !== 'none') {
    assets.push({
      uid: `a-background-${targetUid}`,
      kind: 'background-image',
      hasUrl: /url\(/i.test(rootBackground),
      description: 'CSS background image or gradient on the analysis root',
    })
  }

  options.onPhase?.('building-profile', 95)

  // ---- Facts（观察事实） ----
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

  // ---- Inferences（推断，必须带证据） ----
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
    analysisRoot,
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
    analysisScope: options.scope,
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
    states: [
      { state: 'default', captured: true },
      ...UI_STATES.map((state) => ({ state, captured: false })),
    ],
    facts: mergedFacts,
    inferences,
    matchedRules: cssom.rules,
    cssVariables: cssom.variables,
    componentTree: subtree.tree,
    componentCapture: subtree.stats,
    interactions,
    pageContext,
    warnings: [...dom.warnings, ...cssom.warnings],
  }

  const parsed = styleProfileSchema.safeParse(profile)
  if (!parsed.success) {
    throw new Error(
      `StyleProfile failed validation: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    )
  }
  if (subtree.truncated) {
    profile.warnings.push({
      code: 'TREE_TRUNCATED',
      message: `Subtree collection truncated at ${subtree.stats.capturedNodes}/${SUBTREE_MAX_NODES} nodes; omitted ${subtree.stats.omittedNodes} nodes (${subtree.stats.omittedInteractiveNodes} interactive).`,
      severity: 'info',
    })
  }
  options.onPhase?.('building-profile', 100)
  return profile
}

/** 按 property+targetUid 去重（后到优先） */
function dedupeFacts(facts: StyleFact[]): StyleFact[] {
  const seen = new Map<string, StyleFact>()
  for (const fact of facts) {
    seen.set(`${fact.property}::${fact.targetUid ?? ''}`, fact)
  }
  return Array.from(seen.values())
}
