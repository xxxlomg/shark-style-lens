# STYLE_PROFILE_SCHEMA.md —— StyleProfile 数据协议（v0.1）

> 配套文档 A（对应产品文档 §72 / §23 / §60 / §7–§22 / §59）
>
> 版本：v0.1（MVP）
>
> 定位：StyleLens 全系统**核心数据协议**。所有分析引擎的输出、Extension 内部消息 payload、Backend 请求体，都必须是本协议定义的形状，并通过对应的 Zod schema 校验。
>
> 设计原则（产品文档 §71）：
> 1. **Observed Facts 与 Inferences 严格分离**（§2.4 / §60.1）—— 模型不得把推断伪装成页面事实。
> 2. **框架不可知**（§2.2 / §70.2）—— StyleProfile 不绑定任何前端框架/组件库/class 命名，未来 Code Generation 全部建立在其上。
> 3. **首版精简，预留扩展位**（§60 vs §23）—— MVP 只含 14 个顶层字段；Phase 2（Style Intelligence）再扩展 `matchedRules / inheritedStyles / cssVariables 明细 / diagnostics` 等。
> 4. **文本与敏感数据脱敏在采集层完成**（§7 / §39）—— Schema 中出现的任何文本字段都已经是脱敏后的。

---

## 1. 顶层结构

```ts
export interface StyleProfile {
  /** 协议版本，例如 "0.1.0"；Analyzer 与 Consumer 据此做兼容判断 */
  version: string
  /** 被用户选中的目标元素信息（§7） */
  target: TargetInfo
  /** 组件上下文：Boundary 推断 + 外层布局上下文 + 相关节点摘要（§6 / §59.3） */
  context: ContextInfo
  /** DOM 结构快照（目标 + 相关祖先/兄弟/子树，限深限宽）（§7 / §59.2） */
  structure: StructureProfile
  /** 布局语义（Flex / Grid / Position / Box Model）（§11 / §12） */
  layout: LayoutProfile
  /** 间距与盒模型细节（§12） */
  spacing: SpacingProfile
  /** 排版（§13） */
  typography: TypographyProfile
  /** 颜色 / 表面 / 边框 / 圆角 / 阴影 / 伪元素（§14 / §15 / §16） */
  visual: VisualProfile
  /** 资源（img / svg / icon / background-image）（§18，只描述不上传原文件） */
  assets: AssetProfile[]
  /** 响应式上下文（§22，MVP 只记当前 viewport + 命中 media query） */
  responsive: ResponsiveProfile
  /** 交互状态（§17，MVP 只记录当前状态） */
  states: StateProfile[]
  /** 观察事实（Observed Facts）（§60.1） */
  facts: StyleFact[]
  /** 推断（Inferences）（§60.1） */
  inferences: Inference[]
  /** 分析警告（降级 / 边界情况上报）（§41 / §19 / §20） */
  warnings: AnalysisWarning[]
}
```

## 2. 通用基础类型

```ts
/** 尺寸。值保留原始单位字符串（如 "40px"），数字字段为解析后的 px 数值 */
export interface Size {
  width: number   // px
  height: number  // px
}

/** 矩形（基于 getBoundingClientRect，viewport 坐标） */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

/** 四边值（保留原始字符串，如 "0px" / "auto"） */
export interface Edges {
  top: string
  right: string
  bottom: string
  left: string
}

/** 颜色：同时保留观察值、归一化值与 token（§14） */
export interface ColorInfo {
  /** 浏览器观察到的原始值，如 "rgb(99, 102, 241)" */
  observed: string
  /** 归一化 #RRGGBB（无 alpha 时）或 rgba() 字符串 */
  normalized: string
  /** 若该颜色来自 CSS 变量，记录变量名（§10） */
  token?: string
  /** 0–1 */
  alpha?: number
}
```

## 3. TargetInfo —— 目标元素（§7）

```ts
export interface TargetInfo {
  /** 会话内唯一 id，用于跨消息引用（由 Selector Engine 生成） */
  uid: string
  tagName: string
  role?: string
  id?: string
  classes: string[]
  /** 脱敏后的 attributes（§7：不含 value/password/token 等） */
  attributes: Record<string, string>
  /** 脱敏后的文本摘要（限长、去邮箱/电话/URL token，见 §7 规则） */
  textContent?: string
  childCount: number
  /** 当前渲染矩形 */
  rect: Rect
  /** 稳定的 CSS selector 路径（供 re-select / 调试） */
  selector?: string
  /** 是否处于 Shadow Root 内（§19） */
  isShadowBoundary: boolean
  /** 是否位于 iframe 内（§20） */
  insideIframe: boolean
}
```

## 4. ContextInfo —— 组件上下文（§6 / §59.3）

```ts
/** 组件边界推断结果（输出是「候选推断」而非「确定结论」） */
export interface ComponentInference {
  kind: string          // 如 "card" | "button" | "navbar" | "form" | "unknown"
  confidence: number    // 0–1
  evidence: string[]    // 依据信号，如 "visual-enclosure" | "semantic-tag" | "sibling-repetition"
}

/** 相关节点的精简摘要（不展开完整子树） */
export interface DOMNodeSummary {
  uid: string
  tagName: string
  classes: string[]
  role?: string
  childCount: number
  rect?: Rect
}

export interface ContextInfo {
  /** 主要组件上下文候选（§6.2：如 Button + Footer + Card） */
  componentBoundary?: ComponentInference
  /** 外层布局上下文（§6.2：如 section → grid），按从近到远排序 */
  outerLayoutContext: string[]
  /** 有限深度的祖先摘要（默认至多 6 层，§59.2） */
  ancestors: DOMNodeSummary[]
  /** 有限数量的兄弟摘要（默认至多 8 个，超出截断） */
  siblings: DOMNodeSummary[]
  /** 有限数量的直接子元素摘要（默认至多 8 个，超出截断） */
  children: DOMNodeSummary[]
}
```

## 5. StructureProfile —— DOM 结构快照（§7 / §59.2）

```ts
export interface DOMNodeSnapshot {
  uid: string
  parentUid?: string
  tagName: string
  role?: string
  id?: string
  classes: string[]
  /** 脱敏后的 attributes */
  attributes: Record<string, string>
  /** 脱敏后的文本摘要 */
  textContent?: string
  childCount: number
  /** 相对目标的 DOM 深度（目标为 0） */
  depth: number
  /** 该节点是否跨越 Shadow DOM 边界（§19） */
  isShadowBoundary?: boolean
}

export interface StructureProfile {
  /** 目标 + 相关祖先/兄弟/子树，扁平数组，通过 uid/parentUid 组织成树 */
  domTree: DOMNodeSnapshot[]
}
```

> 采集边界（§59.2 / §38）：只分析必要 ancestor（默认 ≤ 6 层）、relevant siblings / children（默认 ≤ 8 个，超出截断并在 `warnings` 中记录 `TREE_TRUNCATED`）。禁止全页扫描。

## 6. LayoutProfile —— 布局语义（§11 / §12）

```ts
export interface FlexItem {
  flexGrow: number
  flexShrink: number
  flexBasis: string
  order: number
}

export interface FlexLayout {
  direction: string            // row | row-reverse | column | column-reverse
  wrap: string                 // nowrap | wrap | wrap-reverse
  justifyContent: string
  alignItems: string
  alignContent?: string
  gap: string
  items: FlexItem[]            // 目标自身的 flex item 行为；容器时取 children 摘要
}

export interface GridLayout {
  templateColumns: string      // 如 "repeat(3, 1fr)"
  templateRows?: string
  autoFlow: string
  gap: string
  alignItems: string
  justifyContent: string
}

export interface LayoutProfile {
  display: string              // flex | grid | block | inline-flex | ...
  position: string             // static | relative | absolute | fixed | sticky
  /** 定位上下文描述（哪个祖先提供了 containing block，§11 Position） */
  positionContext?: string
  zIndex?: number
  overflow: string
  /** 当前生效的布局体系（互斥，最多一个） */
  flex?: FlexLayout
  grid?: GridLayout
  /** 语义化布局描述（由 Analyzer 生成，供 Prompt Compiler 直接使用） */
  semanticDescription?: string
  /** 例如 "The container uses a horizontal flex layout with centered cross-axis alignment and 12px spacing between children." */
}
```

## 7. SpacingProfile —— 间距与盒模型（§12）

```ts
export interface SpacingProfile {
  margin: Edges
  padding: Edges
  /** 直接子元素间距（flex/grid gap，无则为 undefined） */
  gap?: string
  boxSizing: string            // content-box | border-box
  /** 渲染尺寸（getBoundingClientRect，含 transform 影响） */
  renderedSize: Size
  /** 布局尺寸（offsetWidth/offsetHeight） */
  layoutSize: Size
}
```

## 8. TypographyProfile —— 排版（§13）

```ts
export interface TypographyProfile {
  fontFamily: string
  /** 字体来源：直接定义 / 继承 / 系统默认（§9 继承分析） */
  fontFamilySource: "direct" | "inherited" | "system"
  fontSize: string
  fontWeight: string
  lineHeight: string
  letterSpacing?: string
  textTransform?: string
  textDecoration?: string
  whiteSpace: string
  wordBreak?: string
  textAlign: string
  /** 语义角色（Analyzer 推断）：primary-heading | secondary-text | caption | action-label | body */
  semanticRole?: string
}
```

> 继承语义（§9）：如果 `fontFamily` / `color` 来自祖先，必须标记 `fontFamilySource: "inherited"`，Prompt 中表达为 "inherits the page's primary sans-serif font family"，禁止写成目标元素直接定义。

## 9. VisualProfile —— 颜色 / 表面 / 边框 / 圆角 / 阴影 / 伪元素（§14 / §15 / §16）

```ts
export interface BackgroundInfo {
  kind: "color" | "gradient" | "image" | "none"
  color?: ColorInfo
  /** 原始 gradient 值，如 "linear-gradient(90deg, #667eea 0%, #764ba2 100%)" */
  gradient?: string
  /** 背景图引用（AssetProfile 的 uid） */
  imageAssetUid?: string
  /** 语义描述：如 "solid accent surface" | "soft gradient" */
  semanticDescription?: string
}

export interface BorderInfo {
  width: string
  style: string
  color: ColorInfo
}

export interface RadiusInfo {
  topLeft: string
  topRight: string
  bottomRight: string
  bottomLeft: string
  /** 四角一致时的汇总值 */
  summary?: string
}

export interface ShadowInfo {
  kind: "outer" | "inner"
  offsetX: string
  offsetY: string
  blur: string
  spread: string
  color: ColorInfo
  /** 语义描述：如 "soft low-elevation shadow" */
  semanticDescription?: string
}

export interface PseudoElementInfo {
  pseudo: "::before" | "::after"
  content?: string
  display: string
  size?: Size
  background?: BackgroundInfo
  color?: ColorInfo
  /** 推断的用途：icon | decorative-line | badge | overlay | ornament | unknown（§16） */
  inferredPurpose?: string
}

export interface VisualProfile {
  color: ColorInfo
  background: BackgroundInfo
  border?: BorderInfo
  radius?: RadiusInfo
  shadows: ShadowInfo[]
  opacity?: number
  backdropFilter?: string
  filter?: string
  /** 伪元素分析（V1 能力，§16）；不可访问时为空数组并在 warnings 记录 */
  pseudoElements: PseudoElementInfo[]
}
```

## 10. AssetProfile —— 资源（§18）

```ts
export interface AssetProfile {
  uid: string
  kind: "image" | "svg" | "icon" | "background-image" | "video-thumbnail"
  /** URL 是否存在（不默认携带 URL 本身，是否携带由脱敏策略决定，§18 / §39） */
  hasUrl: boolean
  /** 脱敏策略允许时才携带 */
  url?: string
  width?: number
  height?: number
  aspectRatio?: string
  objectFit?: string
  objectPosition?: string
  /** SVG 专用 */
  svgViewBox?: string
  /** 语义描述：如 "Uses a 24×24 monochrome SVG icon." */
  description?: string
}
```

## 11. ResponsiveProfile —— 响应式上下文（§22）

```ts
export interface ResponsiveProfile {
  /** 当前 viewport，如 "1440×900" */
  viewport: Size
  devicePixelRatio: number
  colorScheme: "light" | "dark" | "no-preference"
  /** 当前命中的媒体查询条件列表 */
  matchedMediaQueries: string[]
  /** 根元素 font-size（rem 换算基准） */
  rootFontSize: string
  /** 主题语义描述：如 "light theme, neutral surface, blue accent token"（§21） */
  themeSummary?: string
}
```

## 12. StateProfile —— 交互状态（§17）

```ts
export type UIState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "disabled"
  | "checked"
  | "selected"
  | "expanded"

export interface StateProfile {
  state: UIState
  /** true = 实际捕获；false = 未捕获（仅 default 在 MVP 为 true，§17） */
  captured: boolean
  /** 捕获状态下相对 default 的视觉差异（Phase 1.5+ 使用） */
  observedChanges?: Partial<VisualProfile>
}
```

> MVP 规则：`states` 只包含 `{ state: "default", captured: true }`。State Capture（模拟 hover/focus/active 等）为 V1.5+ 能力（§50 Phase 5.3），Schema 预留字段。

## 13. Facts 与 Inferences（§60.1 强制分离）

```ts
/** 观察事实：浏览器直接观察到，不允许是推断结论 */
export interface StyleFact {
  property: string          // 如 "display" | "background-color" | "font-family"
  value: string
  source:
    | "computed"            // getComputedStyle 最终值
    | "css-rule"            // 来自匹配的 CSS 规则（Phase 2 完善来源解析）
    | "inheritance"         // 继承自祖先
    | "variable"            // 经 CSS 变量解析（§10）
  confidence: number        // 0–1（观察类通常为 1）
  /** 该事实属于哪个节点（缺省为目标） */
  targetUid?: string
}

/** 推断：系统/模型的结论，必须带证据，不得伪装成事实 */
export interface Inference {
  type: string              // 如 "component-type" | "layout-intent" | "theme-token" | "semantic-role"
  conclusion: string        // 如 "This is likely a Card component"
  confidence: number        // 0–1
  reason: string[]          // 证据：对应 StyleFact / DOM 信号 / 规则命中的描述
}
```

> 消费规则（写入 Prompt Compiler 约定）：Prompt 可以使用 Inference，但必须与 Facts 分区呈现（§49.4 高级模式显示 Observed / Inferred；默认 Prompt 不暴露内部诊断）。

## 14. AnalysisWarning —— 降级与边界上报（§41 / §19 / §20）

```ts
export interface AnalysisWarning {
  code:
    | "CROSS_ORIGIN_CSSOM"      // 跨域 stylesheet 规则不可读，已降级到 computed（§41）
    | "CLOSED_SHADOW_DOM"       // closed shadow root 内部不可分析（§19）
    | "IFRAME_BOUNDARY"         // 目标位于跨域 iframe，未分析（§20）
    | "TREE_TRUNCATED"          // DOM 采集超出限制被截断（§59.2）
    | "TEXT_TRUNCATED"          // 文本被限长/脱敏（§7）
    | "ELEMENT_DETACHED"        // 分析过程中目标从文档移除（边界情况 10）
    | "PROVIDER_WARNING"        // LLM 侧非致命警告
  message: string
  severity: "info" | "warning" | "error"
}
```

## 15. CSS 变量 / Token（§10，Phase 2 深化，MVP 仅采集使用点）

```ts
/** MVP：记录目标及其相关节点实际消费的 CSS 变量 */
export interface CSSVariableUsage {
  name: string               // 如 "--color-primary"
  resolvedValue: string      // 如 "#6366f1"
  sourceElement?: string     // 定义该变量的元素（root/祖先/自身）
  sourceRule?: string        // 定义该变量的规则（CSSOM 可读时）
  scope?: string             // "root" | "ancestor" | "self"
}
```

> 本类型 MVP 阶段作为 StyleProfile 之外的**附加采集产物**（不进 v0.1 StyleProfile 顶层），由 Analyzer 输出给 Prompt Compiler 使用；Phase 2 再决定是否升入 StyleProfile 顶层字段（§23 中 `cssVariables: CSSVariableUsage[]`）。

## 16. Phase 2 扩展位（§23，首版不含）

以下字段属于产品文档 §23 的完整版结构，**MVP v0.1 不实现**，但 Schema 演进需保持兼容（新增字段均为可选）：

```ts
// Phase 2（Style Intelligence）将扩展：
// - matchedRules: CSSRuleInfo[]      —— 规则溯源（§8.2）
// - inheritedStyles: StyleFact[]     —— 继承链明细（§9）
// - diagnostics: Diagnostic[]        —— 诊断信息（§23）
// - cssVariables 升入顶层             —— §10
export interface CSSRuleInfo {
  selector: string
  stylesheetUrl?: string
  media?: string
  properties: Record<string, string>
  /** 跨域不可读时为 false（§8.2 容错） */
  accessible: boolean
}
```

## 17. PromptOptions —— Prompt 生成参数（与 MESSAGE_PROTOCOL 共享）

```ts
export type TargetFramework =
  | "agnostic"    // 默认：框架无关重建 Prompt（§27）
  | "react"
  | "vue"
  | "html-css"
  | "tailwind"
  | "nextjs"

export interface PromptOptions {
  /** 目标框架（§27：这是 Prompt 生成目标，不是分析前提） */
  targetFramework?: TargetFramework   // 默认 "agnostic"
  /** Prompt 输出语言 */
  language?: "en" | "zh"              // 默认 "en"（§25 模板为英文）
  /** 信息密度档位 */
  detail?: "compact" | "balanced" | "detailed"  // 默认 "balanced"
  /** 是否包含交互状态章节（§17，MVP 仅有 default） */
  includeStates?: boolean             // 默认 true
}
```

## 18. Zod Schema 规范

所有类型必须配套 Zod schema（§62：所有消息 payload 通过 Zod 校验）。规范：

1. **一份 Schema 一处定义**：`src/shared/schemas/style-profile.ts`（未来抽包为 `packages/style-profile`）。
2. **运行时校验点**：① Content Script 生成 StyleProfile 后 `safeParse`（失败走 `ANALYSIS_ERROR`）；② Background 转发前；③ services/api 收到请求体时（返回 400 + zod error 详情）。
3. **宽松策略**：Zod 只做**结构校验**（字段存在、类型正确），不做业务级约束（如 confidence 范围仍校验 0–1，但"哪个字段该有值"由 Analyzer 保证）。
4. **版本字段**：`version` 使用 semver；Consumer 遇到更高 minor 版本时向后兼容处理，更高 major 版本拒绝并提示升级。
5. 示例（Button 的 StyleProfile 完整 JSON 见下一节）。

## 19. 完整示例 —— Button（Pricing Card 内 Primary Action Button）

```json
{
  "version": "0.1.0",
  "target": {
    "uid": "t-0001",
    "tagName": "BUTTON",
    "role": "button",
    "classes": ["btn", "btn-primary"],
    "attributes": { "type": "submit", "data-variant": "primary" },
    "textContent": "Get Started",
    "childCount": 2,
    "rect": { "x": 540, "y": 412, "width": 128, "height": 40, "top": 412, "right": 668, "bottom": 452, "left": 540 },
    "selector": "main > section.pricing > div.card > div.card-footer > button.btn-primary",
    "isShadowBoundary": false,
    "insideIframe": false
  },
  "context": {
    "componentBoundary": { "kind": "card", "confidence": 0.82, "evidence": ["visual-enclosure", "padding-container", "flex-parent"] },
    "outerLayoutContext": ["section", "grid"],
    "ancestors": [
      { "uid": "n-0004", "tagName": "DIV", "classes": ["card-footer"], "childCount": 2 },
      { "uid": "n-0003", "tagName": "DIV", "classes": ["card"], "childCount": 4 },
      { "uid": "n-0002", "tagName": "DIV", "classes": ["pricing-grid"], "childCount": 3 }
    ],
    "siblings": [
      { "uid": "n-0005", "tagName": "A", "classes": ["btn", "btn-ghost"], "childCount": 1 }
    ],
    "children": [
      { "uid": "n-0010", "tagName": "SPAN", "classes": ["btn-label"], "childCount": 0 },
      { "uid": "n-0011", "tagName": "SPAN", "classes": ["btn-icon"], "childCount": 0 }
    ]
  },
  "structure": {
    "domTree": [
      { "uid": "n-0003", "tagName": "DIV", "classes": ["card"], "childCount": 4, "depth": -2 },
      { "uid": "n-0004", "tagName": "DIV", "classes": ["card-footer"], "childCount": 2, "depth": -1 },
      { "uid": "t-0001", "tagName": "BUTTON", "classes": ["btn", "btn-primary"], "childCount": 2, "depth": 0 },
      { "uid": "n-0010", "tagName": "SPAN", "classes": ["btn-label"], "childCount": 0, "depth": 1 },
      { "uid": "n-0011", "tagName": "SPAN", "classes": ["btn-icon"], "childCount": 0, "depth": 1 }
    ]
  },
  "layout": {
    "display": "inline-flex",
    "position": "static",
    "positionContext": "static (document flow)",
    "overflow": "visible",
    "flex": {
      "direction": "row",
      "wrap": "nowrap",
      "justifyContent": "center",
      "alignItems": "center",
      "gap": "8px",
      "items": []
    },
    "semanticDescription": "Compact horizontal inline-flex action control with centered content and stable icon/text gap."
  },
  "spacing": {
    "margin": { "top": "0px", "right": "0px", "bottom": "0px", "left": "0px" },
    "padding": { "top": "0px", "right": "16px", "bottom": "0px", "left": "16px" },
    "boxSizing": "border-box",
    "renderedSize": { "width": 128, "height": 40 },
    "layoutSize": { "width": 128, "height": 40 }
  },
  "typography": {
    "fontFamily": "Inter, system-ui, sans-serif",
    "fontFamilySource": "inherited",
    "fontSize": "14px",
    "fontWeight": "600",
    "lineHeight": "40px",
    "letterSpacing": "0.01em",
    "textAlign": "center",
    "whiteSpace": "nowrap",
    "semanticRole": "action-label"
  },
  "visual": {
    "color": { "observed": "rgb(255, 255, 255)", "normalized": "#ffffff" },
    "background": {
      "kind": "color",
      "color": { "observed": "rgb(99, 102, 241)", "normalized": "#6366f1", "token": "--color-primary" },
      "semanticDescription": "Solid accent surface"
    },
    "border": { "width": "0px", "style": "none", "color": { "observed": "rgba(0, 0, 0, 0)", "normalized": "#000000", "alpha": 0 } },
    "radius": { "topLeft": "8px", "topRight": "8px", "bottomRight": "8px", "bottomLeft": "8px", "summary": "8px" },
    "shadows": [],
    "opacity": 1,
    "pseudoElements": []
  },
  "assets": [],
  "responsive": {
    "viewport": { "width": 1440, "height": 900 },
    "devicePixelRatio": 1,
    "colorScheme": "light",
    "matchedMediaQueries": ["(min-width: 1024px)"],
    "rootFontSize": "16px",
    "themeSummary": "light theme, neutral surface, blue accent token"
  },
  "states": [{ "state": "default", "captured": true }],
  "facts": [
    { "property": "display", "value": "inline-flex", "source": "computed", "confidence": 1 },
    { "property": "gap", "value": "8px", "source": "computed", "confidence": 1 },
    { "property": "border-radius", "value": "8px", "source": "css-rule", "confidence": 0.9 },
    { "property": "background-color", "value": "#6366f1", "source": "variable", "confidence": 1 },
    { "property": "font-family", "value": "Inter, system-ui, sans-serif", "source": "inheritance", "confidence": 1 }
  ],
  "inferences": [
    { "type": "component-type", "conclusion": "This is a primary action button inside a pricing card footer.", "confidence": 0.85, "reason": ["inline-flex display", "solid accent background", "semantic tag BUTTON", "located in card-footer flex row"] },
    { "type": "theme-token", "conclusion": "The accent color likely belongs to the site's primary token scale.", "confidence": 0.7, "reason": ["--color-primary resolves to the observed background"] }
  ],
  "warnings": [
    { "code": "CROSS_ORIGIN_CSSOM", "message": "Some stylesheet rules could not be inspected due to browser security restrictions; analysis continues using computed styles.", "severity": "info" }
  ]
}
```

## 20. 变更与演进规则

1. **v0.1 → v0.2 的升级路径**：Phase 2 新增字段一律可选（`?`）或新增顶层可选字段，`version` minor +1；不允许删除/重命名已有必填字段。
2. **Golden fixture 联动**：`tests/fixtures/**` 下每个组件保存一份预期 StyleProfile JSON（§67.3），Schema 变更必须同步更新 golden 并跑回归。
3. **与 MESSAGE_PROTOCOL 的关系**：本协议定义"数据长什么样"；MESSAGE_PROTOCOL 定义"数据怎么传"（消息封装、SSE 事件）。两者共享 `PromptOptions` 类型。
4. **与 MVP_TASK_BACKLOG 的关系**：Sprint 3 的 Analyzer 任务按本协议实现采集与构建；Sprint 4 的 Prompt Compiler 按本协议消费。

---

*本文件由任务 0.2 产出。任何对 StyleProfile 形状的修改，必须先更新本文件并同步 MESSAGE_PROTOCOL / MVP_TASK_BACKLOG / golden fixtures。*
