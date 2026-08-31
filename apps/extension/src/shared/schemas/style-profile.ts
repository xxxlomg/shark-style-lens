/**
 * StyleProfile 数据协议 v0.1 —— TypeScript 类型 + Zod schema
 *
 * 与 docs/STYLE_PROFILE_SCHEMA.md 一一对应（配套文档 A）。
 * 约定：
 *  - Observed Facts 与 Inferences 严格分离（facts / inferences 两个独立数组）
 *  - 所有文本字段均为脱敏后值（采集层完成脱敏）
 *  - Phase 2 扩展位（matchedRules / inheritedStyles / diagnostics）首版不含
 */
import { z } from 'zod'
import { visionEvidenceSchema } from './vision-evidence'

/* ---------- 2. 通用基础类型 ---------- */

export const sizeSchema = z.object({
  width: z.number(),
  height: z.number(),
})
export type Size = z.infer<typeof sizeSchema>

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
})
export type Rect = z.infer<typeof rectSchema>

export const edgesSchema = z.object({
  top: z.string(),
  right: z.string(),
  bottom: z.string(),
  left: z.string(),
})
export type Edges = z.infer<typeof edgesSchema>

export const colorInfoSchema = z.object({
  observed: z.string(),
  normalized: z.string(),
  token: z.string().optional(),
  alpha: z.number().min(0).max(1).optional(),
})
export type ColorInfo = z.infer<typeof colorInfoSchema>

/* ---------- 3. TargetInfo ---------- */

export const targetInfoSchema = z.object({
  uid: z.string(),
  selectedUid: z.string().optional(),
  tagName: z.string(),
  role: z.string().optional(),
  id: z.string().optional(),
  classes: z.array(z.string()),
  attributes: z.record(z.string(), z.string()),
  textContent: z.string().optional(),
  childCount: z.number(),
  rect: rectSchema,
  selector: z.string().optional(),
  isShadowBoundary: z.boolean(),
  insideIframe: z.boolean(),
})
export type TargetInfo = z.infer<typeof targetInfoSchema>

/* ---------- 4. ContextInfo ---------- */

export const componentInferenceSchema = z.object({
  kind: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()),
  rootUid: z.string().optional(),
  rootTagName: z.string().optional(),
  rootClasses: z.array(z.string()).optional(),
})
export type ComponentInference = z.infer<typeof componentInferenceSchema>

export const domNodeSummarySchema = z.object({
  uid: z.string(),
  tagName: z.string(),
  classes: z.array(z.string()),
  role: z.string().optional(),
  childCount: z.number(),
  rect: rectSchema.optional(),
})
export type DOMNodeSummary = z.infer<typeof domNodeSummarySchema>

export const contextInfoSchema = z.object({
  componentBoundary: componentInferenceSchema.optional(),
  outerLayoutContext: z.array(z.string()),
  ancestors: z.array(domNodeSummarySchema),
  siblings: z.array(domNodeSummarySchema),
  children: z.array(domNodeSummarySchema),
})
export type ContextInfo = z.infer<typeof contextInfoSchema>

/* ---------- 5. StructureProfile ---------- */

export const domNodeSnapshotSchema = z.object({
  uid: z.string(),
  parentUid: z.string().optional(),
  tagName: z.string(),
  role: z.string().optional(),
  id: z.string().optional(),
  classes: z.array(z.string()),
  attributes: z.record(z.string(), z.string()),
  textContent: z.string().optional(),
  childCount: z.number(),
  depth: z.number(),
  isShadowBoundary: z.boolean().optional(),
})
export type DOMNodeSnapshot = z.infer<typeof domNodeSnapshotSchema>

export const structureProfileSchema = z.object({
  domTree: z.array(domNodeSnapshotSchema),
})
export type StructureProfile = z.infer<typeof structureProfileSchema>

/* ---------- 6. LayoutProfile ---------- */

export const flexItemSchema = z.object({
  flexGrow: z.number(),
  flexShrink: z.number(),
  flexBasis: z.string(),
  order: z.number(),
})
export type FlexItem = z.infer<typeof flexItemSchema>

export const flexLayoutSchema = z.object({
  direction: z.string(),
  wrap: z.string(),
  justifyContent: z.string(),
  alignItems: z.string(),
  alignContent: z.string().optional(),
  gap: z.string(),
  items: z.array(flexItemSchema),
})
export type FlexLayout = z.infer<typeof flexLayoutSchema>

export const gridLayoutSchema = z.object({
  templateColumns: z.string(),
  templateRows: z.string().optional(),
  autoFlow: z.string(),
  gap: z.string(),
  alignItems: z.string(),
  justifyContent: z.string(),
})
export type GridLayout = z.infer<typeof gridLayoutSchema>

export const layoutProfileSchema = z.object({
  display: z.string(),
  position: z.string(),
  positionContext: z.string().optional(),
  zIndex: z.number().optional(),
  overflow: z.string(),
  flex: flexLayoutSchema.optional(),
  grid: gridLayoutSchema.optional(),
  semanticDescription: z.string().optional(),
})
export type LayoutProfile = z.infer<typeof layoutProfileSchema>

/* ---------- 7. SpacingProfile ---------- */

export const spacingProfileSchema = z.object({
  margin: edgesSchema,
  padding: edgesSchema,
  gap: z.string().optional(),
  boxSizing: z.string(),
  renderedSize: sizeSchema,
  layoutSize: sizeSchema,
})
export type SpacingProfile = z.infer<typeof spacingProfileSchema>

/* ---------- 8. TypographyProfile ---------- */

export const typographyProfileSchema = z.object({
  fontFamily: z.string(),
  fontFamilySource: z.enum(['direct', 'inherited', 'system']),
  fontSize: z.string(),
  fontWeight: z.string(),
  lineHeight: z.string(),
  letterSpacing: z.string().optional(),
  textTransform: z.string().optional(),
  textDecoration: z.string().optional(),
  whiteSpace: z.string(),
  wordBreak: z.string().optional(),
  textAlign: z.string(),
  semanticRole: z.string().optional(),
})
export type TypographyProfile = z.infer<typeof typographyProfileSchema>

/* ---------- 9. VisualProfile ---------- */

export const backgroundInfoSchema = z.object({
  kind: z.enum(['color', 'gradient', 'image', 'none']),
  color: colorInfoSchema.optional(),
  gradient: z.string().optional(),
  imageAssetUid: z.string().optional(),
  semanticDescription: z.string().optional(),
})
export type BackgroundInfo = z.infer<typeof backgroundInfoSchema>

const borderSideSchema = z.object({
  width: z.string(),
  style: z.string(),
  color: colorInfoSchema,
})
export const borderInfoSchema = z.object({
  width: z.string(),
  style: z.string(),
  color: colorInfoSchema,
  sides: z
    .object({
      top: borderSideSchema,
      right: borderSideSchema,
      bottom: borderSideSchema,
      left: borderSideSchema,
    })
    .optional(),
})
export type BorderInfo = z.infer<typeof borderInfoSchema>

export const radiusInfoSchema = z.object({
  topLeft: z.string(),
  topRight: z.string(),
  bottomRight: z.string(),
  bottomLeft: z.string(),
  summary: z.string().optional(),
})
export type RadiusInfo = z.infer<typeof radiusInfoSchema>

export const shadowInfoSchema = z.object({
  kind: z.enum(['outer', 'inner']),
  offsetX: z.string(),
  offsetY: z.string(),
  blur: z.string(),
  spread: z.string(),
  color: colorInfoSchema,
  semanticDescription: z.string().optional(),
})
export type ShadowInfo = z.infer<typeof shadowInfoSchema>

export const pseudoElementInfoSchema = z.object({
  pseudo: z.enum(['::before', '::after']),
  content: z.string().optional(),
  display: z.string(),
  size: sizeSchema.optional(),
  position: z.string().optional(),
  backgroundSize: z.string().optional(),
  borderRadius: z.string().optional(),
  boxShadow: z.string().optional(),
  transform: z.string().optional(),
  clipPath: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  background: backgroundInfoSchema.optional(),
  color: colorInfoSchema.optional(),
  inferredPurpose: z.string().optional(),
})
export type PseudoElementInfo = z.infer<typeof pseudoElementInfoSchema>

export const visualProfileSchema = z.object({
  color: colorInfoSchema,
  background: backgroundInfoSchema,
  border: borderInfoSchema.optional(),
  radius: radiusInfoSchema.optional(),
  shadows: z.array(shadowInfoSchema),
  opacity: z.number().optional(),
  effectiveOpacity: z.number().min(0).max(1).optional(),
  transform: z.string().optional(),
  transformOrigin: z.string().optional(),
  clipPath: z.string().optional(),
  maskImage: z.string().optional(),
  mixBlendMode: z.string().optional(),
  isolation: z.string().optional(),
  backdropFilter: z.string().optional(),
  filter: z.string().optional(),
  pseudoElements: z.array(pseudoElementInfoSchema),
})
export type VisualProfile = z.infer<typeof visualProfileSchema>

/* ---------- 10. AssetProfile ---------- */

export const assetProfileSchema = z.object({
  uid: z.string(),
  kind: z.enum(['image', 'svg', 'icon', 'background-image', 'video-thumbnail']),
  hasUrl: z.boolean(),
  url: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  aspectRatio: z.string().optional(),
  objectFit: z.string().optional(),
  objectPosition: z.string().optional(),
  svgViewBox: z.string().optional(),
  description: z.string().optional(),
})
export type AssetProfile = z.infer<typeof assetProfileSchema>

/* ---------- 11. ResponsiveProfile ---------- */

export const responsiveProfileSchema = z.object({
  viewport: sizeSchema,
  devicePixelRatio: z.number(),
  colorScheme: z.enum(['light', 'dark', 'no-preference']),
  matchedMediaQueries: z.array(z.string()),
  rootFontSize: z.string(),
  themeSummary: z.string().optional(),
})
export type ResponsiveProfile = z.infer<typeof responsiveProfileSchema>

/* ---------- 12. StateProfile ---------- */

export const uiStateSchema = z.enum([
  'default',
  'hover',
  'focus',
  'active',
  'disabled',
  'checked',
  'selected',
  'expanded',
  'pressed',
])
export type UIState = z.infer<typeof uiStateSchema>

export const stateProfileSchema = z.object({
  state: uiStateSchema,
  captured: z.boolean(),
  observedChanges: visualProfileSchema.partial().optional(),
})
export type StateProfile = z.infer<typeof stateProfileSchema>

/* ---------- 13. Facts / Inferences ---------- */

export const styleFactSchema = z.object({
  property: z.string(),
  value: z.string(),
  source: z.enum(['computed', 'css-rule', 'inheritance', 'variable']),
  confidence: z.number().min(0).max(1),
  targetUid: z.string().optional(),
})
export type StyleFact = z.infer<typeof styleFactSchema>

export const inferenceSchema = z.object({
  type: z.string(),
  conclusion: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.array(z.string()),
})
export type Inference = z.infer<typeof inferenceSchema>

/* ---------- 14. AnalysisWarning ---------- */

export const warningCodeSchema = z.enum([
  'CROSS_ORIGIN_CSSOM',
  'CLOSED_SHADOW_DOM',
  'IFRAME_BOUNDARY',
  'TREE_TRUNCATED',
  'TEXT_TRUNCATED',
  'ELEMENT_DETACHED',
  'PROVIDER_WARNING',
])

export const analysisWarningSchema = z.object({
  code: warningCodeSchema,
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
})
export type AnalysisWarning = z.infer<typeof analysisWarningSchema>

/* ---------- 15. CSSVariableUsage（附加采集产物，MVP 不进顶层） ---------- */

export const cssVariableUsageSchema = z.object({
  name: z.string(),
  resolvedValue: z.string(),
  sourceElement: z.string().optional(),
  sourceRule: z.string().optional(),
  scope: z.string().optional(),
})
export type CSSVariableUsage = z.infer<typeof cssVariableUsageSchema>

export const matchedRuleSchema = z.object({
  selector: z.string(),
  stylesheetUrl: z.string().optional(),
  media: z.string().optional(),
  properties: z.record(z.string(), z.string()),
  accessible: z.boolean(),
})
export type MatchedRule = z.infer<typeof matchedRuleSchema>

/* ---------- 16. SubtreeNode（子树深度解析，保真度提升 T1） ---------- */

export const subtreeRoleSchema = z.enum([
  'text',
  'button',
  'icon',
  'input',
  'control',
  'badge',
  'image',
  'toolbar',
  'divider',
  'link',
  'container',
])
export type SubtreeRole = z.infer<typeof subtreeRoleSchema>

export const subtreeRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export type SubtreeRect = z.infer<typeof subtreeRectSchema>

export const subtreeTypographySchema = z.object({
  fontSize: z.string(),
  fontWeight: z.string(),
  lineHeight: z.string(),
})
export type SubtreeTypography = z.infer<typeof subtreeTypographySchema>

export const subtreeStateSchema = z.object({
  disabled: z.boolean().optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  checked: z.boolean().optional(),
  pressed: z.boolean().optional(),
  indeterminate: z.boolean().optional(),
  current: z.string().optional(),
})
export type SubtreeState = z.infer<typeof subtreeStateSchema>

export const subtreeControlSchema = z.object({
  kind: z.string(),
  type: z.string().optional(),
  placeholder: z.string().optional(),
  title: z.string().optional(),
  valuePresent: z.boolean().optional(),
})
export type SubtreeControl = z.infer<typeof subtreeControlSchema>

export interface SubtreeNode {
  uid: string
  parentUid?: string
  childIndex?: number
  depth?: number
  tagName: string
  roleGuess: SubtreeRole
  semanticRole?: string
  interactive?: boolean
  visibilityState?: 'visible' | 'opacity-zero'
  effectiveOpacity?: number
  actionHint?: string
  state?: SubtreeState
  attributes?: Record<string, string>
  control?: SubtreeControl
  rect?: SubtreeRect
  computed?: Record<string, string>
  layout?: string
  background?: string
  color?: string
  border?: string
  radius?: string
  shadow?: string
  typography?: SubtreeTypography
  pseudoElements?: PseudoElementInfo[]
  textContent?: string
  children: SubtreeNode[]
}

export const subtreeNodeSchema: z.ZodType<SubtreeNode> = z.lazy(() =>
  z.object({
    uid: z.string(),
    parentUid: z.string().optional(),
    childIndex: z.number().int().nonnegative().optional(),
    depth: z.number().int().nonnegative().optional(),
    tagName: z.string(),
    roleGuess: subtreeRoleSchema,
    semanticRole: z.string().optional(),
    interactive: z.boolean().optional(),
    visibilityState: z.enum(['visible', 'opacity-zero']).optional(),
    effectiveOpacity: z.number().min(0).max(1).optional(),
    actionHint: z.string().optional(),
    state: subtreeStateSchema.optional(),
    attributes: z.record(z.string(), z.string()).optional(),
    control: subtreeControlSchema.optional(),
    rect: subtreeRectSchema.optional(),
    computed: z.record(z.string(), z.string()).optional(),
    layout: z.string().optional(),
    background: z.string().optional(),
    color: z.string().optional(),
    border: z.string().optional(),
    radius: z.string().optional(),
    shadow: z.string().optional(),
    typography: subtreeTypographySchema.optional(),
    pseudoElements: z.array(pseudoElementInfoSchema).optional(),
    textContent: z.string().optional(),
    children: z.array(subtreeNodeSchema),
  }),
)

/* ---------- 17. PageContext（页面主题与调色板，保真度提升 T2） ---------- */

export const paletteEntrySchema = z.object({
  hex: z.string(),
  count: z.number(),
  usage: z.string(),
})
export type PaletteEntry = z.infer<typeof paletteEntrySchema>

export const pageContextSchema = z.object({
  pageBackground: z.string().optional(),
  scheme: z.enum(['dark', 'light', 'unknown']),
  palette: z.array(paletteEntrySchema),
})
export type PageContext = z.infer<typeof pageContextSchema>

/* ---------- 18. PromptOptions ---------- */

export const targetFrameworkSchema = z.enum([
  'agnostic',
  'react',
  'vue',
  'html-css',
  'tailwind',
  'nextjs',
])
export type TargetFramework = z.infer<typeof targetFrameworkSchema>

export const promptOptionsSchema = z.object({
  targetFramework: targetFrameworkSchema.optional(),
  language: z.literal('en').optional(),
  detail: z.enum(['compact', 'balanced', 'detailed']).optional(),
  includeStates: z.boolean().optional(),
})
export type PromptOptions = z.infer<typeof promptOptionsSchema>

/* ---------- 1. StyleProfile 顶层 ---------- */

export const styleProfileSchema = z.object({
  version: z.string(),
  analysisScope: z.enum(['element', 'component']).optional(),
  target: targetInfoSchema,
  context: contextInfoSchema,
  structure: structureProfileSchema,
  layout: layoutProfileSchema,
  spacing: spacingProfileSchema,
  typography: typographyProfileSchema,
  visual: visualProfileSchema,
  assets: z.array(assetProfileSchema),
  responsive: responsiveProfileSchema,
  states: z.array(stateProfileSchema),
  facts: z.array(styleFactSchema),
  inferences: z.array(inferenceSchema),
  matchedRules: z.array(matchedRuleSchema).optional(),
  cssVariables: z.array(cssVariableUsageSchema).optional(),
  visionEvidence: visionEvidenceSchema.optional(),
  componentTree: z.array(subtreeNodeSchema).optional(),
  pageContext: pageContextSchema.optional(),
  warnings: z.array(analysisWarningSchema),
})
export type StyleProfile = z.infer<typeof styleProfileSchema>
