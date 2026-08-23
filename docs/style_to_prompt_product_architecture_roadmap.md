# Style → Prompt Chrome Extension — Technical Specification

> 项目代号：StyleLens（暂定）
>
> 文档版本：v0.2
>
> 文档定位：产品规格 + 技术架构 + 交互设计 + DOM/CSS 分析引擎 + Prompt 生成体系 + MV3 工程规范 + 开发路线图
>
> 目标读者：产品设计、前端开发、Chrome Extension 开发、AI/LLM 工程人员
>
> 核心目标：用户在网页上看到一个喜欢的 UI 元素或组件时，无需知道它采用 React、Vue、Svelte 还是原生 HTML，也无需自己理解 DOM/CSS，只需要选择它，插件就自动分析其视觉、布局、结构和上下文，并流式生成一份可直接交给 AI 编程工具的高质量 UI 复刻 Prompt。

---

## 1. 产品定义

### 1.1 一句话定义

**Style → Prompt 是一个“网页 UI 视觉逆向工程” Chrome 插件：点击网页上的任意 UI，自动理解它的 DOM、CSS、继承、布局、视觉上下文和资源，并把分析结果编译成面向 AI 编程模型的 UI 复刻 Prompt。**

### 1.2 它不是什么

它不是：

- 传统 CSS Inspector
- HTML/CSS 复制器
- React/Vue 源码还原器
- 简单的 Screenshot → Code 工具
- 只输出一堆 `getComputedStyle()` 的调试工具

### 1.3 它真正解决的问题

用户通常知道：

> “这个东西很好看，我想让 AI 做一个一样的。”

但用户不知道如何描述：

- 它到底是什么组件？
- 哪些 CSS 属性决定了视觉效果？
- 为什么它的位置是这样的？
- 哪些样式来自父元素？
- 哪些样式来自 CSS Variable？
- 它依赖哪个布局上下文？
- 它和旁边元素有什么关系？
- 哪些信息是必要的，哪些只是网页噪声？
- 应该怎样告诉 AI 才能尽可能复刻？

插件的职责就是把这些复杂问题隐藏起来。

---

# 2. 产品核心原则

## 2.1 原则一：随意（Low Friction / Free-form）

用户不应该感觉自己在操作一套复杂的开发者工具。

理想体验：

```text
看到喜欢的 UI
    ↓
点一下
    ↓
分析
    ↓
一个浮空面板出现
    ↓
随意拖动面板
    ↓
看 AI 生成的 Prompt
    ↓
复制
```

用户应该能够：

- 自由选择元素
- 随意拖动结果面板
- 不被强制吸附
- 不需要理解 DOM 层级
- 随时重新选择
- 随时扩大分析范围
- 随时复制结果
- 不必先配置复杂选项

### 2.1.1 面板定位规则

第一次生成时：

- 面板默认出现在目标元素附近
- 尽量不遮挡目标元素
- 自动选择视口内最合适的位置

用户拖动后：

- 面板脱离目标元素
- 不再强制跟随目标元素
- 记住当前位置
- 后续分析默认复用用户最后的位置

可选增强：

- 接近浏览器边缘时轻微吸附
- 但不能强制吸附

核心原则：**用户控制位置，插件只提供默认位置。**

---

## 2.2 原则二：视觉复刻优先（Visual Fidelity First）

插件不试图判断原网站用了什么前端框架。

输入可能来自：

- React
- Vue
- Svelte
- Angular
- Web Components
- 原生 HTML
- SSR 模板
- CMS 模板
- 任意 JavaScript 框架

这些都不是核心目标。

因为网页最终呈现给浏览器的是：

```text
HTML
CSS
JavaScript
浏览器 Layout / Paint / Rendering
```

插件应该关注的是：

> **这个 UI 最终呈现为什么样子，以及它依赖什么结构和上下文。**

因此 Prompt 默认要求：

- 不假设原始框架
- 不假设原始组件库
- 不假设原始 class 命名
- 不假设原始源码结构
- 优先描述视觉事实与实现约束
- 在用户指定技术栈时再生成对应实现形式

---

## 2.3 原则三：不要做 CSS Dump，要做 UI Reverse Engineering

错误方向：

```text
<button>
  width: 96px;
  height: 40px;
  padding: 0 16px;
  ...
</button>
```

正确方向：

```text
Component: Primary Action Button

Visual hierarchy:
- Compact horizontal action control
- Rounded rectangular shape
- Medium visual emphasis

Layout:
- Inline flex container
- Centered content
- Fixed height
- Horizontal padding
- Stable icon/text gap

Typography:
- Semibold label
- Compact line-height

Surface:
- Solid accent background
- High-contrast foreground
- Medium corner radius

Interaction:
- Hover changes surface treatment
- Focus requires visible keyboard indicator

Context:
- Positioned within a card footer
- Footer uses horizontal alignment
```

插件的核心价值是：

**从浏览器事实提炼为可供 AI 执行的 UI Specification。**

---

## 2.4 原则四：Observed 与 Inferred 必须分离

这是核心数据设计原则。

### Observed Facts

浏览器直接观察到的事实：

- `display: flex`
- `gap: 16px`
- `border-radius: 12px`
- `font-size: 14px`
- CSS Variable 来源
- 实际 Bounding Rect
- 实际颜色

### Inferences

系统或模型推断出的结论：

- “这很可能是一个 Card”
- “这些元素很可能属于同一个组件”
- “该布局可能是为列表场景设计的”
- “这个 Token 可能属于主题色体系”

最终 Prompt 可以使用推断，但不能把推断伪装成原网页的事实。

建议数据结构：

```ts
interface StyleFact {
  property: string;
  value: string;
  source:
    | 'computed'
    | 'css-rule'
    | 'inheritance'
    | 'css-variable'
    | 'layout'
    | 'asset'
    | 'dom';
  confidence?: number;
}

interface Inference {
  type: string;
  description: string;
  confidence: number;
  evidence: string[];
}
```

---

# 3. 用户核心体验

## 3.1 MVP 主流程

```text
用户浏览网页
    ↓
启动插件
    ↓
进入 Select Mode
    ↓
鼠标 Hover
    ↓
目标元素高亮
    ↓
点击目标
    ↓
锁定目标
    ↓
点击 Confirm / Analyze
    ↓
分析 DOM + CSS + Layout + Context + Assets
    ↓
形成 Style Profile
    ↓
发送到 Prompt Generation Pipeline
    ↓
Prompt 流式返回
    ↓
面板流式展示
    ↓
底部固定 Copy Prompt
```

## 3.2 选择模式

建议支持两种入口：

### 入口 A：插件按钮

```text
Chrome Toolbar
    ↓
点击插件
    ↓
选择模式
```

### 入口 B：快捷键

例如：

```text
Alt + Shift + S
```

快捷键应当可配置。

---

# 4. 元素选择系统

## 4.1 Hover 高亮

鼠标进入页面元素时：

- 显示 outline
- 显示半透明 overlay
- 可选显示轻量 tooltip
- tooltip 可以包含：
  - 标签名
  - class 摘要
  - 元素尺寸

示例：

```text
<button.primary>
128 × 40
```

不要在第一版显示大量 CSS。

Hover 的任务只有一个：

> 帮用户确认“我现在指向的是谁”。

---

## 4.2 点击锁定

点击后：

```text
Hover → Selected
```

页面状态：

- 高亮保持
- 鼠标不再改变目标
- 显示小型控制 UI

控制 UI 可以包含：

```text
Selected

[ Analyze ]
[ Re-select ]
[ Analyze Component ]
```

---

## 4.3 错误选择必须低成本恢复

必须支持：

```text
Esc → 取消
Re-select → 重新选择
```

不能要求用户重新加载页面。

---

# 5. 分析范围设计

这是产品体验中的核心概念之一。

不要直接向用户暴露：

- Parent
- Ancestor
- Sibling
- Descendant

这些是内部实现概念。

用户看到的是：

### 当前元素

只分析用户点击的元素。

### 这个组件

分析目标元素以及与它形成明显视觉/结构关系的父子节点。

### 这个区域

进一步扩大上下文，分析更大的 Layout Container。

MVP 可以先支持：

```text
Current Element
Component Context
```

“这个区域”作为 V1.5 / V2。

---

# 6. Component Boundary 推断

不能简单使用：

```text
Parent → Parent → Parent
```

一直递归到 `body`。

必须判断“哪些祖先节点真正与组件视觉有关”。

## 6.1 可使用的信号

### DOM 信号

- tag
- role
- aria attributes
- class names
- data-* attributes
- child count
- sibling count
- DOM depth

### Layout 信号

- flex parent
- grid parent
- positioned ancestor
- width/height constraints
- alignment
- gap
- overflow

### Visual signals

- background
- border
- shadow
- radius
- padding

### Spacing signals

- margin
- gap
- parent padding

### Semantic signals

- heading
- button
- input
- link
- form
- navigation
- article
- dialog

## 6.2 Boundary 推断规则

例如：

```text
Button
 ↓
Footer
 ↓
Card
 ↓
Grid
 ↓
Section
```

系统应该优先认为：

```text
Button + Footer + Card
```

是主要组件上下文。

而：

```text
Grid + Section
```

更多属于外部布局上下文。

最终可以生成：

```text
Component Boundary:
Card

Outer Layout Context:
Section → Grid
```

---

# 7. DOM 分析引擎

## 7.1 Target DOM

至少采集：

```ts
interface DOMNodeSnapshot {
  tagName: string;
  role?: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  textContent?: string;
  childCount: number;
}
```

注意：

**不要默认上传完整文本内容。**

应进行：

- 文本长度限制
- 邮箱过滤
- 电话号码过滤
- URL 中 token 过滤
- input value 默认不上传
- password 永远不上传
- aria-label 按需脱敏

---

# 8. CSS 分析引擎

CSS 是整个产品最重要的底层能力之一。

不能只依赖：

```js
getComputedStyle(element)
```

而应该形成多层 CSS 信息。

## 8.1 Computed Style

获取最终生效值：

- display
- position
- width / height
- min / max
- margin
- padding
- gap
- font
- color
- background
- border
- shadow
- radius
- opacity
- transform
- overflow
- z-index
- visibility
- pointer-events
- white-space
- text alignment

---

## 8.2 CSS Rule 来源

通过 CSSOM 尝试定位：

```text
computed value
    ↓
matched rule
    ↓
selector
    ↓
stylesheet
```

目标不是恢复所有源码，而是理解：

> 当前视觉事实由什么规则产生。

需要处理：

- document.styleSheets
- cssRules
- media rules
- supports rules
- pseudo rules（尽可能）

跨域 stylesheet 访问受到浏览器安全策略限制，因此必须容错。

---

# 9. CSS Inheritance 分析

很多视觉属性并不直接定义在 Target 上。

例如：

```css
body {
  color: #111;
  font-family: Inter;
}

.card {
  padding: 24px;
}
```

Button 最终显示的字体和颜色可能来自祖先。

因此系统需要区分：

```text
Direct
Inherited
Initial
User Agent
```

最终 Prompt 中可以表达：

> The component inherits the page's primary sans-serif font family.

但不要把它错误写成：

```css
button {
  font-family: Inter;
}
```

---

# 10. CSS Variable / Design Token 分析

CSS Variable 是高价值信息。

例如：

```css
--color-primary
--color-background
--radius-md
--spacing-4
--shadow-card
```

不能只输出最终值：

```text
#6366f1
```

应该尝试输出：

```text
Token:
--color-primary

Resolved value:
#6366f1
```

这样 AI 更容易理解设计系统。

内部结构：

```ts
interface CSSVariableUsage {
  name: string;
  resolvedValue: string;
  sourceElement?: string;
  sourceRule?: string;
  scope?: string;
}
```

---

# 11. Layout Analysis

不能仅输出：

```text
display: flex
```

必须解释布局语义。

## Flex

分析：

- direction
- wrap
- justify-content
- align-items
- align-content
- gap
- flex-grow
- flex-shrink
- basis

最终可转换为：

> The container uses a horizontal flex layout with centered cross-axis alignment and 12px spacing between children.

## Grid

分析：

- template columns
- template rows
- auto flow
- gap
- alignment
- track sizing

## Position

分析：

- static
- relative
- absolute
- fixed
- sticky

特别注意：

> 一个元素为什么“出现在这里”通常依赖父级 Layout Context，而不是自身 CSS。

---

# 12. Box Model 分析

生成标准视觉尺寸描述：

```text
Content
Padding
Border
Margin
```

并结合 BoundingClientRect：

```text
Rendered size
Layout size
```

必须注意：

- box-sizing
- fractional pixels
- transforms
- zoom
- devicePixelRatio

---

# 13. Typography 分析

Typography 是视觉复刻的重要部分。

采集：

- font-family
- fallback family
- font-size
- font-weight
- line-height
- letter-spacing
- text-transform
- text-decoration
- white-space
- word-break
- text-align

同时建议生成语义描述：

```text
Primary heading
Secondary text
Caption
Action label
```

而不是只输出数值。

---

# 14. Color / Surface 分析

分析：

- foreground color
- background color
- gradient
- alpha
- border color
- box shadow
- text shadow
- backdrop-filter
- filter

颜色建议同时保存：

```text
Observed:
rgb(...)

Normalized:
#RRGGBB

Token:
--color-primary
```

---

# 15. Border / Radius / Shadow

重点提取：

- border width
- border style
- border color
- border radius
- per-corner radius
- shadow offset
- blur
- spread
- shadow color
- inset shadow

并将它们转换为视觉语言。

例如：

> A medium-radius rounded surface with a soft low-elevation shadow.

---

# 16. Pseudo Elements

尽可能分析：

```text
::before
::after
```

因为很多网站的：

- icon
- decorative line
- badge
- overlay
- background ornament

都不是 DOM 子节点。

对 pseudo-element 的分析属于高优先级 V1 能力。

---

# 17. State 分析

用户选择一个元素时，默认只能观察到当前状态。

但是要复刻 UI，通常还需要：

- hover
- focus
- active
- disabled
- checked
- selected
- expanded

MVP 可以先记录当前状态。

V1 可以加入：

```text
Capture States
```

通过 DevTools-like 的方式临时模拟部分伪类。

---

# 18. Asset 分析

针对：

- img
- background-image
- SVG
- icon
- video thumbnail

提取：

- asset 类型
- URL 是否存在
- 尺寸
- aspect ratio
- object-fit
- object-position
- background sizing
- SVG viewBox

但是不要默认把资源文件直接上传到模型。

第一阶段可以只描述：

```text
Uses a 24×24 monochrome SVG icon.
```

后续再支持资源下载/重建。

---

# 19. Shadow DOM

需要识别：

```text
element.getRootNode()
```

如果处于 Shadow Root：

- 记录 Shadow DOM 边界
- 尽可能分析内部结构
- 标识 shadow boundary
- 不能假设外部 CSS 会直接作用于内部

对于：

- closed Shadow DOM
- third-party web components

要允许分析失败并友好提示。

---

# 20. iframe

iframe 是重大边界。

### Same-origin iframe

可以进一步注入 Content Script 并分析。

### Cross-origin iframe

受到浏览器安全限制。

第一版策略：

- 识别 iframe
- 提示“内容来自嵌入页面”
- 如果当前上下文无法访问，不强行分析

后续再设计跨 frame 协调协议。

---

# 21. 页面上下文与 Theme

一个组件不能脱离它的 Theme。

至少分析：

- color scheme
- body background
- root variables
- inherited font
- root font size
- viewport size
- devicePixelRatio
- media query 命中情况

Prompt 应表达：

> The component is rendered within a light theme using a neutral surface and a blue accent token.

而不是只给出几个颜色。

---

# 22. Responsive Context

第一版记录当前 viewport：

```text
Viewport:
1440 × 900
```

同时记录当前命中的 Media Query 条件。

后续可以支持：

```text
Capture responsive behavior
```

例如：

```text
Desktop:
3 columns

Mobile:
1 column
```

这是视觉复刻能力后期非常重要的一部分。

---

# 23. Style Profile：核心中间数据层

整个系统最重要的工程抽象不是 Prompt，而是：

# StyleProfile

它是：

```text
Browser DOM/CSS
        ↓
  StyleProfile
        ↓
  Prompt Compiler
        ↓
  LLM
```

## 23.1 建议结构

```ts
interface StyleProfile {
  target: TargetProfile;
  componentContext: ComponentContext;
  domTree: DOMNodeSnapshot[];
  layout: LayoutProfile;
  typography: TypographyProfile;
  surface: SurfaceProfile;
  spacing: SpacingProfile;
  borders: BorderProfile;
  shadows: ShadowProfile;
  cssVariables: CSSVariableUsage[];
  inheritedStyles: StyleFact[];
  matchedRules: CSSRuleInfo[];
  assets: AssetProfile[];
  states: StateProfile[];
  viewport: ViewportProfile;
  theme: ThemeProfile;
  observations: StyleFact[];
  inferences: Inference[];
  diagnostics: Diagnostic[];
}
```

---

# 24. Prompt Generation 架构

建议不要让 LLM 直接从原始 DOM 开始写 Prompt。

正确链路：

```text
DOM/CSS
  ↓
Normalizer
  ↓
StyleProfile
  ↓
Prompt Compiler
  ↓
LLM
  ↓
Streaming Prompt
```

## 24.1 Prompt Compiler

负责：

- 删除噪声
- 合并重复信息
- 把 CSS 数值变成语义描述
- 对 Layout 形成结构化总结
- 对 Theme 提取关键 Token
- 对 DOM 形成组件树
- 对事实与推断进行分类
- 控制 Prompt 长度

LLM 的职责：

- 理解上下文
- 组织语言
- 推断组件语义
- 生成最终可执行 Prompt

---

# 25. Prompt 输出结构

推荐默认生成：

```markdown
# Recreate This UI Component

## Goal

Recreate the selected UI as closely as possible to the observed result.
Do not assume the original frontend framework.

## Component Context

...

## Structure

...

## Layout

...

## Spacing

...

## Typography

...

## Colors & Surfaces

...

## Borders & Shadows

...

## Assets

...

## Responsive Context

...

## Interaction States

...

## Implementation Requirements

...

## Fidelity Requirements

...
```

---

# 26. Prompt 的核心目标

Prompt 必须明确告诉 AI：

```text
Prioritize visual fidelity over source-code similarity.

Do not attempt to reproduce the original framework.

Reproduce:
- visual hierarchy
- spacing
- proportions
- typography
- color
- surface treatment
- layout behavior
- responsive intent
- component relationships
```

---

# 27. 用户技术栈选择策略

第一版不要强行要求用户输入：

```text
React / Vue / Tailwind / CSS Modules...
```

默认：

```text
Framework-agnostic UI reconstruction prompt
```

后续支持：

```text
React
Vue
HTML/CSS
Tailwind
Next.js
```

这些应该是 Prompt Generation 的 Target，而不是 DOM 分析引擎的前提。

---

# 28. 流式生成体验

用户强调“流式加载”，因此它不是一个装饰效果，而应该是产品核心体验。

状态应该清晰：

```text
Preparing analysis...
    ↓
Inspecting structure...
    ↓
Understanding layout...
    ↓
Generating prompt...
    ↓
Streaming...
    ↓
Completed
```

不要在网络请求未完成之前显示一个空白大面板。

第一时间应该出现：

```text
Analyzing component…
```

然后逐渐填充内容。

---

# 29. Prompt 面板设计

建议结构：

```text
┌────────────────────────────────────┐
│ StyleLens                           │
│ ● Analyzing component              │
├────────────────────────────────────┤
│                                    │
│ Component Context                  │
│ ...                                │
│                                    │
│ Layout                             │
│ ...                                │
│                                    │
│ Typography                         │
│ ...                                │
│                                    │
│ Prompt                             │
│ ...流式生成...                     │
│                                    │
├────────────────────────────────────┤
│              Copy Prompt           │
└────────────────────────────────────┘
```

## 29.1 面板特性

- 可拖拽
- 可滚动
- 面板内部 Prompt 区域自动滚动
- 顶部保持状态信息
- 底部 Copy 按钮固定
- 生成结束后可展开/折叠章节
- 不影响网页正常交互

---

# 30. 浮层实现策略

建议插件 UI 使用：

**Content Script + 独立 Shadow DOM Root**

原因：

- 隔离页面 CSS
- 避免页面样式污染插件 UI
- 插件样式更加稳定
- 可维护 React/Vue UI

建议结构：

```text
Content Script
    ↓
createElement('div')
    ↓
ShadowRoot
    ↓
Plugin UI
```

---

# 31. Chrome Extension 架构

目标：Manifest V3

整体建议：

```text
Chrome Extension
│
├── Background Service Worker
│
├── Content Script
│   ├── Selector Engine
│   ├── DOM Analyzer
│   ├── CSS Analyzer
│   ├── Layout Analyzer
│   ├── Asset Analyzer
│   └── Overlay UI
│
├── Popup
│   └── Lightweight Settings / Start
│
├── Storage
│   ├── Settings
│   ├── Prompt History
│   └── Last Panel Position
│
└── Backend / LLM API
    ├── Analysis API
    ├── Prompt Generation
    └── Streaming API
```

---

# 32. Content Script 负责什么

Content Script 是网页分析核心。

负责：

- 元素选择
- Hover Overlay
- Target 锁定
- DOM Snapshot
- Computed Style
- CSSOM 分析
- Layout Context
- CSS Variables
- Assets
- Shadow DOM 边界
- iframe 识别
- 页面 UI 浮层

它不应该承担：

- API Key 管理
- 长期数据处理
- 用户账号逻辑
- Prompt 历史数据库

这些由后端 / Extension Service Worker 配合处理。

---

# 33. Background Service Worker

职责：

- extension lifecycle
- command shortcuts
- tab messaging
- settings synchronization
- API bridge
- future authentication

原则：

**Service Worker 是协调器，不是 DOM 分析器。**

因为 DOM 访问需要发生在对应页面上下文。

---

# 34. Popup

第一版 Popup 极简：

```text
StyleLens

[ Select Element ]

Shortcut:
Alt + Shift + S

Target:
Framework-agnostic
```

后续再加入：

- Prompt language
- AI provider
- Target framework
- history
- privacy settings

不要把核心体验做成 Popup 操作。

---

# 35. Side Panel 与 DevTools 的定位

第一版不依赖 Side Panel / DevTools。

原因：

核心体验是：

> “就在网页上选，马上在附近看到结果。”

后续可以扩展：

### Side Panel

适合：

- Prompt History
- Saved Components
- Settings
- Model Selection
- Comparison

### DevTools

适合专业模式：

- DOM Tree
- CSS Sources
- Selector debugging
- Computed Style inspection
- Advanced analysis

因此：

```text
MVP = Page Overlay
V1 = Page Overlay + Side Panel
V2 = DevTools Advanced Mode
```

---

# 36. 通讯模型

建议：

```text
Content Script
      │
      │ chrome.runtime.sendMessage
      ↓
Background
      │
      ↓
Backend API
      │
      │ Streaming
      ↓
Background
      │
      ↓
Content Script
      ↓
Overlay UI
```

如果模型接口允许安全的浏览器直连，也可以在后续版本简化链路，但第一版不应把私密 API Key 放在 Extension 前端。

---

# 37. Streaming 技术建议

后端可采用：

- SSE
- Fetch streaming
- AI SDK streaming

Content Script 收到增量文本后：

```text
append token
    ↓
update prompt state
    ↓
auto-scroll
```

要避免每一个 token 都触发昂贵的 DOM reflow。

建议使用：

```text
buffer → animation frame / batch update
```

---

# 38. 性能策略

这是插件非常容易失败的一点。

禁止：

- 页面全 DOM 扫描
- 鼠标移动时频繁深层计算
- 每个 hover 都跑完整 CSS 分析
- 选择后立即上传整页

建议：

```text
Hover
↓
只计算 elementFromPoint + rect
```

点击后才：

```text
Deep Analysis
```

分析范围默认为：

```text
Target
+ relevant ancestors
+ relevant siblings
+ relevant children
```

而不是整个页面。

---

# 39. 数据脱敏与隐私

必须从 MVP 就设计。

不能上传：

- password
- input values
- auth token
- cookies
- localStorage 内容
- sessionStorage 内容
- 页面私密数据

对文本内容：

- 限长
- 可配置是否上传
- 可识别明显 PII

Prompt 生成请求应尽量使用：

```text
Structure + styles + semantic hints
```

而不是完整网页内容。

---

# 40. 权限设计

尽量避免不必要权限。

核心可能需要：

- `activeTab`
- `scripting`
- `storage`

是否需要广泛的 `host_permissions` 应根据具体注入策略决定。

原则：

> 最小权限原则。

---

# 41. 错误与降级策略

不能因为某个 CSS 文件跨域就整个分析失败。

系统应该分层降级：

```text
完整 CSSOM
   ↓ 失败
Computed Style
   ↓ 失败
Layout + DOM
   ↓
仍然输出 Prompt
```

例如：

```text
Some stylesheet rules could not be inspected due to browser security restrictions.
The visual analysis continues using computed styles and layout information.
```

---

# 42. MVP 验收标准

MVP 不以“功能很多”作为完成标准，而以“复刻效果是否真的有用”为标准。

建议准备至少 20 个真实组件：

- Button
- Card
- Pricing Card
- Navbar
- Dropdown
- Modal
- Form
- Input
- Badge
- Avatar Group
- Table Row
- Sidebar Item
- Hero Section
- Notification
- Tooltip
- Tabs
- Search Bar
- Product Card
- Dashboard Widget
- Footer Section

测试用户选择这些元素后：

> 另一个 AI 编程工具是否能够仅凭生成 Prompt，较高保真地重建该 UI？

---

# 43. 质量指标

建议定义：

## Q1 Selection Accuracy

用户点击后目标元素是否准确。

## Q2 Context Accuracy

系统分析的上下文是否合理。

## Q3 Style Coverage

重要视觉因素是否被覆盖：

- layout
- spacing
- typography
- color
- surface
- border
- shadow
- responsive

## Q4 Prompt Usability

Prompt 是否可以直接复制给 AI。

## Q5 Visual Reconstruction Fidelity

最终 AI 实现与原组件的视觉相似度。

真正的 North Star Metric 应该是：

# Visual Reconstruction Fidelity

而不是：

- 抓取了多少 CSS 属性
- DOM 节点数量
- Prompt 有多少字

---

# 44. 技术栈建议

## Extension

**v0.2 统一确定：Vite + React + TypeScript + Manifest V3。**

UI 基础：

```text
React
├── shadcn/ui
└── Tailwind CSS 4
```

工程基础：

```text
Vite
TypeScript strict
pnpm
ESLint
Prettier
Vitest
Playwright
```

不采用 Plasmo 作为核心依赖，原因是这个产品后续需要高度控制：

- Content Script 生命周期
- Shadow DOM 注入
- 多入口构建
- MV3 Service Worker
- runtime messaging
- CSP / 权限 / bundle 行为

**架构原则：框架负责工程效率，Chrome Extension 原生能力负责运行时边界。**

### UI Isolation

网页是“不可信宿主环境”。插件 UI 必须挂载到独立 Shadow Root，避免：

- 网站全局 CSS 污染插件
- 插件 reset 污染网站
- `button` / `input` / `*` 等全局选择器冲突
- Tailwind utility 与宿主页面 class 命名冲突

Tailwind CSS 4 和 shadcn/ui **只服务于插件 UI，不参与目标网页样式分析**。

## Backend

建议：

```text
Next.js / Node.js
```

负责：

- API
- streaming
- auth
- rate limit
- provider abstraction

## AI

模型层设计为 provider-agnostic：

```text
OpenAI
Anthropic
Gemini
Other providers
```

避免把插件产品能力绑定到一个模型。

---

# 45. Repository 建议结构

```text
stylelens/
│
├── apps/
│   ├── extension/
│   │   ├── src/
│   │   │   ├── background/
│   │   │   ├── content/
│   │   │   │   ├── selector/
│   │   │   │   ├── analyzer/
│   │   │   │   ├── overlay/
│   │   │   │   └── state/
│   │   │   ├── popup/
│   │   │   └── shared/
│   │   └── manifest.json
│   │
│   └── web/
│
├── packages/
│   ├── style-profile/
│   ├── prompt-engine/
│   ├── shared-types/
│   └── ui/
│
└── services/
    └── api/
```

---

# 46. 核心模块拆分

## Selector Engine

负责：

- hover target
- click target
- lock target
- re-select
- element outline

## DOM Analyzer

负责：

- DOM snapshot
- parent/ancestor
- child/sibling
- semantic hints
- component boundary

## CSS Analyzer

负责：

- computed style
- CSSOM
- inheritance
- variables
- media rules

## Layout Analyzer

负责：

- flex
- grid
- position
- box model
- alignment
- rendered rect

## Asset Analyzer

负责：

- image
- SVG
- background
- icon

## Context Analyzer

负责：

- theme
- viewport
- layout context
- component context

## StyleProfile Builder

负责：

- normalization
- deduplication
- confidence
- final structured model

## Prompt Compiler

负责：

- transform StyleProfile → LLM-ready context

## Prompt Generator

负责：

- LLM call
- streaming
- final Prompt

## Overlay UI

负责：

- selection UI
- analysis state
- result panel
- drag
- copy

---

# 47. UI 状态机

建议状态：

```text
IDLE
  ↓
SELECTING
  ↓
SELECTED
  ↓
ANALYZING
  ↓
GENERATING
  ↓
COMPLETED
```

异常状态：

```text
ERROR
```

可以随时：

```text
SELECTED → SELECTING
COMPLETED → SELECTING
ERROR → SELECTING
```

---

# 48. 面板状态机

```text
Hidden
 ↓
Anchored
 ↓
Generating
 ↓
Streaming
 ↓
Complete
```

用户拖动后：

```text
Anchored → Floating
```

Floating 不再跟随 Target。

---

# 49. “真的好用”的关键设计判断

## 49.1 不要暴露技术复杂度

用户不应该看到：

```text
CSSOM
Computed Style
Ancestor
```

这些属于内部系统。

用户应该看到：

```text
这个元素
这个组件
这个区域
```

---

## 49.2 不要追求源码还原

不要把产品目标定义成：

> “找出原网站用了什么代码。”

而应该是：

> “给另一个 AI 足够的信息，让它重新做出来。”

---

## 49.3 不要生成过度冗长 Prompt

信息多不代表 Prompt 好。

需要一个：

```text
Signal → Normalize → Rank → Summarize
```

过程。

高价值信息优先：

1. Structure
2. Layout
3. Spacing
4. Typography
5. Surface
6. Color
7. Border / Radius
8. Shadow
9. Assets
10. Responsive
11. State

---

## 49.4 用户应该相信结果

可以在高级模式显示：

```text
Observed
Inferred
```

但是默认 Prompt 不需要把所有内部诊断暴露给用户。

---

# 50. Roadmap

## Phase 0：技术验证

目标：证明浏览器能够可靠获取核心信息。

任务：

- [ ] MV3 最小插件
- [ ] Content Script 注入
- [ ] Hover Selector
- [ ] Click Target
- [ ] Bounding Rect
- [ ] Computed Style
- [ ] DOM Snapshot
- [ ] 基础父级分析
- [ ] 基础 Flex/Grid 分析
- [ ] CSS Variable 读取
- [ ] Shadow DOM 探测
- [ ] iframe 探测

交付物：

```text
一个能在真实网页中准确选择元素并打印 StyleProfile 的原型。
```

---

## Phase 1：MVP UI

目标：形成完整闭环。

任务：

- [ ] 浮空面板
- [ ] Shadow DOM UI
- [ ] 可拖拽
- [ ] Select / Confirm
- [ ] Re-select
- [ ] Loading State
- [ ] Prompt Streaming
- [ ] Copy Prompt
- [ ] Error State
- [ ] 面板位置记忆

交付物：

```text
Select → Analyze → Stream → Copy
```

完整跑通。

---

## Phase 2：Style Intelligence

目标：让 Prompt 真正有价值。

任务：

- [ ] Component Boundary 推断
- [ ] CSS Rule source
- [ ] Inheritance graph
- [ ] CSS Variable dependency
- [ ] Typography semantics
- [ ] Surface semantics
- [ ] Layout semantics
- [ ] Theme context
- [ ] Asset analysis
- [ ] Pseudo-elements
- [ ] Observed / Inferred 分离

目标：

> 让 AI 不只是知道“有哪些 CSS”，而是知道“为什么这个 UI 长成这样”。

---

## Phase 3：Prompt Quality

目标：提升视觉复刻质量。

任务：

- [ ] Prompt Compiler
- [ ] Prompt section ranking
- [ ] Context compression
- [ ] Framework-agnostic Prompt
- [ ] React target
- [ ] Tailwind target
- [ ] HTML/CSS target
- [ ] Prompt presets
- [ ] Model/provider abstraction

---

## Phase 4：真实评测体系

建立 20～50 个组件 benchmark。

每一个组件记录：

```text
Original Screenshot
Original DOM
StyleProfile
Generated Prompt
AI Reimplementation
Similarity Score
```

测试不同网站：

- SaaS
- E-commerce
- Dashboard
- Documentation
- Marketing site
- Blog
- Web App

重点测试：

- 深层 DOM
- complex flex
- grid
- inherited typography
- CSS variables
- shadow DOM
- pseudo elements
- responsive UI

---

## Phase 5：高级能力

### 5.1 “这个组件”模式

自动推断更完整组件边界。

### 5.2 “这个区域”模式

分析 Section / Layout Container。

### 5.3 State Capture

模拟：

- hover
- focus
- active
- disabled
- checked

### 5.4 Responsive Capture

多 viewport 对比。

### 5.5 Side Panel

提供：

- 历史
- 收藏
- Prompt Library
- Settings

### 5.6 DevTools Mode

给专业开发者查看：

- DOM tree
- CSS rule source
- variable graph
- component boundary
- style diagnostics

---

# 51. V2 产品想象

最终可以发展为：

```text
                 StyleLens
                     │
        ┌────────────┼────────────┐
        ↓            ↓            ↓
      Inspect      Explain      Recreate
        │            │            │
        ↓            ↓            ↓
      DOM/CSS      AI Insight    Prompt
```

最终用户不仅可以：

> “帮我复制这个组件。”

还可以：

> “帮我理解这个组件为什么这么设计。”

> “把这个组件转换成 Tailwind。”

> “把这个设计复刻到我的 React 项目。”

> “分析这个页面使用了哪些设计 Token。”

但这些都应该建立在 MVP 的 StyleProfile 基础之上。

---

# 52. 最重要的工程决策

本项目最值得长期维护的核心不是 UI，也不是 Prompt 模板，而是：

# StyleProfile Engine

因为未来无论：

- 模型变化
- Prompt 变化
- AI Provider 变化
- UI 变化
- React/Vue/Tailwind 输出变化

只要 StyleProfile 是稳定的，整个产品就可以持续演进。

因此工程优先级应该是：

```text
StyleProfile Engine
      >
Prompt Compiler
      >
Prompt UI
      >
Settings / History
```

---

# 53. 最终产品闭环

```text
                    ┌───────────────────┐
                    │      网页 UI      │
                    └─────────┬─────────┘
                              │
                           Select
                              │
                              ↓
                    ┌───────────────────┐
                    │ Selector Engine   │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │ DOM / CSS / Layout│
                    │ Context Analyzer  │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │   StyleProfile    │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │ Prompt Compiler   │
                    └─────────┬─────────┘
                              │
                              ↓
                    ┌───────────────────┐
                    │       LLM         │
                    └─────────┬─────────┘
                              │
                         Streaming
                              │
                              ↓
                    ┌───────────────────┐
                    │ Floating Prompt   │
                    │      Panel        │
                    └─────────┬─────────┘
                              │
                           Copy
                              │
                              ↓
                    ┌───────────────────┐
                    │ Cursor / Claude /  │
                    │ ChatGPT / Gemini  │
                    └───────────────────┘
```

---

# 54. 最终产品判断

这个产品最重要的差异化不是：

> “我能抓到更多 CSS。”

而是：

> **“我能把一个你无法描述的 UI，变成 AI 能够执行的描述。”**

因此产品的 North Star 应该定义为：

# 从“我喜欢这个 UI，但我说不清楚”到“我可以直接把它交给 AI 重做”。

而技术上的 North Star 则是：

# 从 Browser Rendering → StyleProfile → Visual Reconstruction Prompt。

最终用户体验必须保持极简：

```text
选
→ 看
→ 拖
→ 复制
```

所有复杂性都由系统在背后完成：

```text
DOM
CSSOM
Computed Style
Inheritance
Variables
Layout
Context
Assets
States
Theme
AI Reasoning
Prompt Compilation
```

这就是 StyleLens 应该坚持的产品边界和技术方向。


---

# 55. v0.2 技术规格总览

## 55.1 技术选型最终结论

| 层 | 方案 | 说明 |
|---|---|---|
| Extension Runtime | Chrome Manifest V3 | 当前产品运行基础 |
| Build | Vite | 多入口、可控、轻量 |
| Language | TypeScript strict | 强约束核心数据协议 |
| UI | React | 浮层、Popup、Side Panel 共用 |
| UI Components | shadcn/ui | 可控、源码级组件 |
| Styling | Tailwind CSS 4 | 插件内部 UI 快速开发 |
| Isolation | Shadow DOM | 防止宿主页面 CSS 污染 |
| State | Zustand | 轻量、跨 UI 模块共享 |
| Validation | Zod | StyleProfile / Message / API schema |
| Messaging | chrome.runtime / chrome.tabs | Runtime 间通信 |
| Testing | Vitest + Playwright | 单测 + 浏览器集成测试 |
| Package Manager | pnpm | Monorepo / workspace 友好 |
| AI Transport | fetch streaming / SSE | 流式 Prompt |

## 55.2 架构边界

系统必须拆成四个边界：

```text
Browser Page
    │
    │ DOM/CSS access
    ▼
Content Runtime
    │
    │ normalized messages
    ▼
Extension Runtime
    │
    │ AI request
    ▼
AI / Backend
    │
    │ stream
    ▼
Overlay UI
```

核心原则：**分析引擎不依赖 React，UI 不直接理解 DOM 原始细节。**

这样可以让：

```text
DOM/CSS Engine → 独立测试 / 未来 VS Code / Web App
React UI       → 独立迭代
Prompt Engine  → 独立替换模型提供商
```

---

# 56. 推荐 Repository 结构 v0.2

```text
stylelens/
├── apps/
│   └── extension/
│       ├── src/
│       │   ├── background/
│       │   │   ├── index.ts
│       │   │   ├── message-router.ts
│       │   │   └── ai-client.ts
│       │   │
│       │   ├── content/
│       │   │   ├── index.ts
│       │   │   ├── selector/
│       │   │   ├── overlay/
│       │   │   ├── analyzer/
│       │   │   └── bridge/
│       │   │
│       │   ├── popup/
│       │   │   ├── App.tsx
│       │   │   └── components/
│       │   │
│       │   ├── sidepanel/
│       │   │   ├── App.tsx
│       │   │   └── components/
│       │   │
│       │   └── shared/
│       │       ├── constants/
│       │       ├── messages/
│       │       └── utils/
│       │
│       ├── manifest.json
│       └── vite.config.ts
│
├── packages/
│   ├── style-profile/
│   ├── dom-analyzer/
│   ├── css-analyzer/
│   ├── layout-analyzer/
│   ├── prompt-engine/
│   ├── shared-types/
│   └── ui/
│
├── services/
│   └── api/
│
├── tests/
│   ├── fixtures/
│   ├── unit/
│   └── e2e/
│
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

> MVP 可以先放在一个 extension app 中；一旦 StyleProfile、Analyzer 与 Prompt Engine 成熟，再逐步抽成 packages。

---

# 57. Chrome MV3 Runtime 设计

## 57.1 Content Script

Content Script 是网页感知层，负责：

- 元素 hover / click selection
- DOM / CSSOM 采集
- Layout measurements
- Component context 推断
- Shadow DOM Overlay
- 页面状态读取

不负责：

- 持久化 API token
- 复杂 AI provider orchestration
- 长期任务管理

## 57.2 Background Service Worker

负责：

- runtime message routing
- AI request orchestration
- auth / config
- tab lifecycle
- storage access
- streaming relay

由于 MV3 Service Worker 不是常驻进程，不能依赖内存保存关键业务状态。关键会话状态要么放在：

```text
chrome.storage
或
Content / UI 当前内存状态
```

## 57.3 Popup

Popup 不是核心分析界面，只负责：

- 开始选择
- 快捷设置
- AI provider / model 设置
- 最近分析

## 57.4 Side Panel

V2 用作：

- 历史 Prompt
- StyleProfile 查看
- 多版本 Prompt
- Model 设置
- Export

MVP 不依赖 Side Panel 完成主闭环。

---

# 58. Overlay UI 与 Shadow DOM 规范

## 58.1 Mount 策略

Content Script 创建：

```text
<div id="stylelens-root">
  #shadow-root
    React App
</div>
```

所有插件 UI 组件挂载到 Shadow Root。

## 58.2 页面中的唯一职责

Overlay 只负责：

- 选择态视觉提示
- 分析状态
- 流式 Prompt
- 拖拽
- Copy
- Re-select
- Context scope 切换

## 58.3 面板定位

初次生成时：

```text
target rect
    ↓
nearest safe position
    ↓
viewport clamp
```

用户手动拖拽后：

```text
manual position
    ↓
retain until session ends
```

默认不强制吸附。

---

# 59. DOM / CSS 分析引擎技术规范

## 59.1 Target Selection

Selection engine 使用：

```text
mousemove
→ elementFromPoint()
→ highlight
→ click
→ lock
```

必要时提供：

```text
Enter = confirm
Esc = cancel
Re-select = restart
```

## 59.2 DOM Context Window

不要无限爬 DOM。推荐：

```text
Target
├── Parent × N
├── Relevant Children
├── Relevant Siblings
└── Component Boundary Candidates
```

默认先限制深度，再通过规则扩展。

## 59.3 Component Boundary 推断

Boundary candidate 依据：

- 距离突变
- background / border / radius
- padding container
- flex / grid container
- sibling repetition
- semantic tag
- class naming hints
- aria / role
- visual enclosure

输出不是“确定的组件”，而是：

```typescript
type ComponentInference = {
  kind: string
  confidence: number
  evidence: string[]
}
```

## 59.4 CSS 数据来源优先级

```text
1. getComputedStyle()
2. CSSStyleDeclaration / CSSOM
3. CSS custom properties
4. inherited properties
5. matching media rules
6. stylesheet metadata
```

`getComputedStyle()` 是事实层，CSSOM 用于解释来源。

## 59.5 不把所有 CSS 属性都发送给模型

需要进行：

```text
collect
→ normalize
→ deduplicate
→ rank
→ summarize
```

例如 `display`, `position`, `gap`, `padding`, `font`, `background`, `border`, `transform` 的优先级明显高于大量浏览器默认属性。

---

# 60. StyleProfile 核心数据协议

StyleProfile 是整个系统的核心资产。

推荐首版结构：

```typescript
export interface StyleProfile {
  version: string
  target: TargetInfo
  context: ContextInfo
  structure: StructureProfile
  layout: LayoutProfile
  spacing: SpacingProfile
  typography: TypographyProfile
  visual: VisualProfile
  assets: AssetProfile[]
  responsive: ResponsiveProfile
  states: StateProfile[]
  facts: StyleFact[]
  inferences: Inference[]
  warnings: AnalysisWarning[]
}
```

## 60.1 Fact 与 Inference 必须分离

```typescript
interface StyleFact {
  property: string
  value: string
  source: 
    | "computed"
    | "css-rule"
    | "inheritance"
    | "variable"
  confidence: number
}

interface Inference {
  type: string
  conclusion: string
  confidence: number
  reason: string[]
}
```

这样可以避免模型把推断误认为页面真实事实。

---

# 61. Zustand 状态设计

推荐将 UI 状态与分析结果拆开。

```typescript
type SelectionState = {
  mode: "idle" | "selecting" | "locked"
  targetId?: string
}

type AnalysisState = {
  status: 
    | "idle"
    | "collecting"
    | "analyzing"
    | "streaming"
    | "complete"
    | "error"
  progress: number
}

type OverlayState = {
  x: number
  y: number
  userMoved: boolean
}
```

分析数据本身不建议大量塞入 UI store；完整 StyleProfile 保持在分析模块或 session store。

---

# 62. Extension Message Protocol

第一天就定义统一消息协议。

```typescript
type ExtensionMessage =
  | { type: "SELECTION_START" }
  | { type: "ELEMENT_SELECTED"; payload: SelectedElement }
  | { type: "ANALYSIS_START"; payload: AnalysisRequest }
  | { type: "ANALYSIS_PROGRESS"; payload: AnalysisProgress }
  | { type: "STYLE_PROFILE_READY"; payload: StyleProfile }
  | { type: "PROMPT_START" }
  | { type: "PROMPT_CHUNK"; payload: { text: string } }
  | { type: "PROMPT_COMPLETE" }
  | { type: "ANALYSIS_ERROR"; payload: ErrorPayload }
```

所有 payload 必须通过 Zod schema 验证。

---

# 63. Prompt Engine v0.2

Prompt Engine 必须分两步：

```text
StyleProfile
    ↓
Prompt Compiler
    ↓
LLM Context
    ↓
Prompt Generator
```

## 63.1 Prompt Compiler

Compiler 负责：

- 去噪
- 选择高价值事实
- 整理层级结构
- 生成 implementation constraints
- 保留 uncertainty

## 63.2 Prompt Generator

模型只需要完成：

> 将结构化 UI reverse-engineering data 组织成可直接用于前端实现的自然语言 Prompt。

模型不应该负责重新猜测已经采集到的 CSS 事实。

---

# 64. Streaming UI 规范

推荐：

```text
fetch()
→ ReadableStream
→ background relay
→ content message
→ Zustand update
→ PromptViewer append
```

## 64.1 流式显示要求

- 首字节尽快出现
- 文本持续增长
- 自动滚动到最新内容
- 用户手动向上滚动后停止强制滚动
- 完成后恢复 Copy 按钮

## 64.2 Copy 行为

使用：

```text
navigator.clipboard.writeText()
```

复制成功给出轻量反馈，不弹阻塞式 Dialog。

---

# 65. 数据隐私与权限 v0.2

## 65.1 最小权限原则

Manifest 不默认申请与核心能力无关的权限。

重点评估：

```text
storage
tabs / activeTab
scripting
sidePanel（V2）
```

实际权限以 MVP 功能和 Chrome 审核要求为准。

## 65.2 数据发送分层

发送 AI 前至少经过：

```text
Raw Page Data
↓
Normalization
↓
Sensitive Data Filter
↓
Prompt Context
↓
Model API
```

不得默认发送：

- Cookie
- localStorage 全量数据
- 表单敏感输入
- 完整页面 HTML
- 无关页面文本

---

# 66. 性能预算

插件必须避免因为分析组件导致页面明显卡顿。

## 66.1 初始目标

```text
Selection highlight：< 16ms 级别交互
Basic snapshot：< 100ms
StyleProfile build：< 500ms（常规组件）
Prompt first token：由网络 / 模型决定
```

## 66.2 分析策略

- 只分析必要 ancestor
- children 超过阈值时截断
- stylesheet 遍历做缓存
- 计算昂贵数据按需加载
- 不在 mousemove 中执行完整分析
- analysis 结束后释放临时对象

---

# 67. 测试策略 v0.2

## 67.1 Unit Test

使用 Vitest 覆盖：

- CSS normalization
- box model calculation
- component boundary inference
- StyleProfile builder
- prompt compiler
- message schema

## 67.2 Browser Integration

使用 Playwright + 测试网页 fixture：

```text
fixtures/
├── plain-html/
├── tailwind/
├── flex-card/
├── grid-layout/
├── nested-component/
├── dark-theme/
├── responsive/
├── shadow-dom/
└── iframe/
```

验证：

- selection 是否正确
- overlay 是否不污染页面
- drag 是否稳定
- prompt 是否完整
- copy 是否成功

## 67.3 Golden StyleProfile

针对固定 fixture 保存预期 StyleProfile，防止 Analyzer 重构后 silently regress。

---

# 68. MVP 开发任务拆解

## Sprint 1：Extension Skeleton

- [ ] Vite + React + TypeScript 初始化
- [ ] Manifest V3
- [ ] Content Script 注入
- [ ] Background Service Worker
- [ ] React overlay + Shadow DOM
- [ ] pnpm workspace
- [ ] ESLint / Prettier / Vitest

## Sprint 2：Selection

- [ ] mouse hover highlight
- [ ] click lock
- [ ] Enter / Escape
- [ ] re-select
- [ ] target rect
- [ ] overlay drag

## Sprint 3：StyleProfile

- [ ] DOM snapshot
- [ ] computed style extraction
- [ ] ancestor context
- [ ] child / sibling summary
- [ ] layout extraction
- [ ] CSS variable extraction
- [ ] normalization

## Sprint 4：Prompt

- [ ] StyleProfile → Prompt Context
- [ ] provider abstraction
- [ ] streaming
- [ ] prompt viewer
- [ ] copy
- [ ] error / retry

## Sprint 5：Quality

- [ ] golden fixtures
- [ ] Playwright e2e
- [ ] performance profiling
- [ ] privacy filter
- [ ] 20 real-world component evaluation

---

# 69. v0.2 验收门槛

只有满足以下条件，MVP 才算真正可用：

### Product

- 用户 5 秒内理解如何开始
- 点击错元素后可以立即重选
- 面板可以自由拖动
- 面板不会破坏原网页布局

### Analyzer

- 常见 Button / Card / Input / Navbar / Modal 可稳定分析
- 能正确识别主要布局上下文
- 能区分 computed fact 与 inference
- CSS variable 可以被解释

### AI

- Prompt 不只是 CSS dump
- Prompt 能说明布局、视觉和上下文
- Prompt 可直接复制到主流 coding model

### Engineering

- Shadow DOM 隔离通过测试
- Chrome MV3 lifecycle 正常
- 无明显页面性能回归
- 核心 analyzer 有 regression fixture

---

# 70. 后续技术扩展

## 70.1 Multi-model

同一个 StyleProfile 支持：

```text
Claude Prompt
GPT Prompt
Gemini Prompt
Cursor Prompt
Generic Prompt
```

## 70.2 Code Generation

StyleProfile 可以继续作为：

```text
React Code Generator
Tailwind Code Generator
HTML/CSS Generator
Vue Generator
```

因此不要让 StyleProfile 与某个框架绑定。

## 70.3 Design Token Extraction

从多个组件聚合出：

- color tokens
- spacing scale
- radius scale
- typography scale
- shadow scale

## 70.4 Component Library Detection

未来可以识别：

- Material UI
- Ant Design
- Chakra
- Radix-like patterns
- Tailwind conventions

但这属于增强功能，不应影响 MVP 的“视觉复刻优先”。

---

# 71. v0.2 最终工程原则

1. **Vite + React + TypeScript 是扩展 UI 和工程基础。**
2. **shadcn/ui + Tailwind CSS 4 只服务插件自身 UI。**
3. **插件 UI 必须通过 Shadow DOM 与宿主页面隔离。**
4. **DOM/CSS Analyzer 与 React 解耦。**
5. **StyleProfile 是产品核心数据协议。**
6. **Observed Facts 与 Inferences 必须严格分离。**
7. **Message Protocol 从第一天开始类型化并用 Zod 校验。**
8. **MVP 先做页面内 Floating Overlay，不依赖 Side Panel。**
9. **技术实现框架不可知，视觉复刻优先。**
10. **所有新增能力尽量建立在 StyleProfile 之上，而不是直接绑定 Prompt 文本。**

---

# 72. 下一阶段建议

进入开发前，建议再产出三个配套文档：

### A. `STYLE_PROFILE_SCHEMA.md`

定义完整的 TypeScript + Zod Schema。

### B. `MESSAGE_PROTOCOL.md`

定义 Content / Background / Popup / Side Panel 的所有消息。

### C. `MVP_TASK_BACKLOG.md`

把 Sprint 拆成可以直接交给 Cursor / Claude Code 执行的开发任务，每项包含：

- objective
- files
- acceptance criteria
- test cases
- dependencies

这三个文件完成后，就可以从“产品设计”正式进入“工程实现”。
