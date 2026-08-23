# MVP_TASK_BACKLOG.md —— StyleLens MVP 开发任务清单

> 配套文档 C（对应产品文档 §50 / §68 / §69 / §42 / §67）
>
> 定位：把 MVP 拆成可直接交给 Cursor / Claude Code 执行的开发任务。每项任务包含：objective / files / acceptance criteria / test cases / dependencies。
>
> 前置输入：`STYLE_PROFILE_SCHEMA.md`（数据协议）、`MESSAGE_PROTOCOL.md`（通信协议）、`stylelens_mvp_task_plan.md`（总计划，含阶段边界）。
>
> 已确认决策：单 app 结构（apps/extension，预留 packages 边界）+ services/api（Hono）+ DeepSeek（deepseek-chat）+ 共享密钥鉴权 + 10 组件 benchmark 起步 + **后端地址硬约束（仅本地 localhost `http://127.0.0.1:3001`，见任务 1.3/4.1/4.6）** + **官网介绍页 + 拖拽安装按钮（任务 1.9）**。

---

## 0. 目标仓库结构（Sprint 1 任务 1.1 落地）

```text
stylelens/                          # 仓库根 = F:\code\ai\shark\shark-style-lens
├── pnpm-workspace.yaml             # 最小 workspace：apps/extension + services/api（见下注）
├── tsconfig.base.json
├── apps/
│   └── extension/                  # 单 app（现有 Vite 脚手架迁移至此）
│       ├── src/
│       │   ├── background/         # index.ts / message-router.ts / ai-client.ts
│       │   ├── content/
│       │   │   ├── index.ts
│       │   │   ├── selector/       # hover/click/lock/keyboard
│       │   │   ├── overlay/        # React + Shadow DOM（Tailwind/shadcn 仅在此）
│       │   │   ├── analyzer/       # dom/css/layout/asset/context/boundary/privacy/profile-builder
│       │   │   └── bridge/         # message 封装（Envelope、traceId、AbortController）
│       │   ├── popup/
│       │   └── shared/             # constants / messages / schemas / utils
│       ├── manifest.json
│       └── vite.config.ts
├── services/
│   └── api/                        # 独立 Node 服务（Hono + SSE）
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/             # health.ts / prompt-stream.ts
│       │   ├── middleware/auth.ts  # 共享密钥
│       │   ├── providers/          # types.ts / deepseek.ts / index.ts
│       │   └── compiler/           # prompt-compiler.ts / templates.ts
│       └── package.json
├── tests/
│   ├── fixtures/                   # plain-html/ tailwind/ flex-card/ grid-layout/
│   │                               # nested-component/ dark-theme/ responsive/
│   │                               # shadow-dom/ iframe/（§67.2）
│   ├── unit/
│   └── e2e/
└── docs/                           # 产品文档 + 3 份配套文档 + 计划书
```

> **注（工程结构决策）**：MVP 采用「单 app」——extension 内部**不**拆 `packages/*`，但 `src/` 按 analyzer / overlay / selector / shared 分模块隔离，未来抽包时边界已就位（§56 注释）。`services/api` 与 `apps/extension` 通过**最小 pnpm workspace** 连接（两者需要共享 Zod schema 与类型，`workspace:*` 引用），这不改变「extension 是单 app」的决策；`packages/*` 目录 MVP 阶段不创建。

---

## 1. Sprint 1 —— Extension Skeleton

> 目标（§68 Sprint 1）：MV3 最小扩展 + Shadow DOM 浮层 + 工程链全绿。
> 退出标准：`pnpm dev` 可加载未打包扩展并在任意页面注入 overlay；`pnpm lint/test/build` 全绿；Shadow DOM 隔离有测试证明。

### 1.1 仓库重构为单 app 布局

- **Objective**：把现有 Vite 脚手架迁移到 `apps/extension/`，建立最小 pnpm workspace（extension + api 占位），删除模板 demo 代码。
- **Files**：
  - 移动：`package.json` / `vite.config.ts` / `tsconfig*.json` / `index.html` / `src/**` → `apps/extension/`
  - 新增：`pnpm-workspace.yaml`、`tsconfig.base.json`、`services/api/package.json`（占位）、根 `README.md`（重写为项目说明）
  - 修改：`apps/extension/package.json`（name 改为 `@stylelens/extension`，deps 按 §55.1 补齐：zod、zustand、@tailwindcss/vite、tailwindcss、class-variance-authority、clsx、tailwind-merge、lucide-react）
- **Acceptance**：`pnpm install` 成功；`apps/extension` 下 `pnpm dev` 出空页面；`services/api` 可 `pnpm dev` 启动空服务；根目录无残留模板代码。
- **Test cases**：`pnpm -r build` 全部通过；`git status` 确认无 `src/App.tsx` 等模板文件。
- **Dependencies**：无（从产品文档与现状直接开始）。

### 1.2 工程链：Prettier + Vitest + 脚本

- **Objective**：补齐格式与测试工具；脚本统一（lint / test / build / dev）。
- **Files**：`apps/extension/.prettierrc`、`vitest.config.ts`、`package.json`（scripts：`lint`、`test`、`test:unit`、`build`、`dev`）；`.oxlintrc.json` 保留（决策 §4.5）。
- **Acceptance**：`pnpm lint` 通过；一个最小 Vitest 用例可跑通；`pnpm test` 退出码 0。
- **Test cases**：`pnpm lint`、`pnpm test`、`pnpm build` 三者分别执行成功。
- **Dependencies**：1.1。

### 1.3 MV3 manifest + Vite 多入口构建

- **Objective**：manifest.json（§40 最小权限：`activeTab` / `scripting` / `storage` + **`host_permissions` 仅含 localhost 范围 `http://127.0.0.1/*`、`http://localhost/*`**，访问本地 services/api，用户硬约束）+ Vite 多入口产出 background / content / popup 三个构建目标；快捷键 `Alt+Shift+S`（manifest commands，可配置 §3.2）。
- **Files**：`apps/extension/manifest.json`、`vite.config.ts`（多入口 + 手写构建脚本，产出 `dist/` 含 manifest；不引入 Plasmo/crxjs，原则 §44）、`src/background/index.ts`、`src/content/index.ts`、`src/popup/index.tsx`（占位）。
- **Acceptance**：`pnpm build` 产出可在 `chrome://extensions` 以「加载已解压的扩展程序」加载的目录；加载后无 manifest 报错；快捷键注册成功；**`host_permissions` 仅含 localhost 两条**（无全站权限，§40 最小权限）。
- **Test cases**：手动加载扩展 → 三个入口均无 console error；`chrome://extensions` 显示无权限告警；manifest 权限清单断言（vitest 读 manifest.json 校验）。
- **Dependencies**：1.1、1.2。

### 1.4 Background SW + message-router 骨架

- **Objective**：按 MESSAGE_PROTOCOL §3 落地消息类型与 Zod schema（`shared/schemas/messages.ts`），Background 具备空路由能力（收消息 → 校验 → 转发/回执）。
- **Files**：`src/shared/schemas/messages.ts`、`src/shared/schemas/style-profile.ts`（从 STYLE_PROFILE_SCHEMA.md 翻译）、`src/background/message-router.ts`、`src/background/index.ts`。
- **Acceptance**：`ELEMENT_SELECTED` / `ANALYSIS_START` / `ANALYSIS_PROGRESS` / `STYLE_PROFILE_READY` / `PROMPT_CHUNK` / `ANALYSIS_ERROR` 全部有 Zod schema；非法 payload 返回 `E_INVALID_PAYLOAD` 且不崩溃；MV3 SW 生命周期（onInstalled / onMessage）正常。
- **Test cases**：Vitest 单测：每个消息 schema 的合法/非法样例；`E_INVALID_PAYLOAD` 分支。
- **Dependencies**：1.3。

### 1.5 Content Script 注入 + Shadow DOM overlay 最小挂载

- **Objective**：content script 注入所有页面（manifest 声明），创建 `#stylelens-root > #shadow-root` 并挂载最小 React App（§30 / §58.1），验证不污染页面。
- **Files**：`src/content/index.ts`、`src/content/overlay/App.tsx`、`src/content/overlay/mount.ts`、`src/content/overlay/styles.css`（入口）。
- **Acceptance**：任意页面出现插件浮层容器；宿主页面 `document.styleSheets` 无插件样式泄漏；插件样式不受宿主 CSS 影响（显式测试：宿主设置 `*{color:red}` 不改变插件 UI）。
- **Test cases**：Playwright：在 `tests/fixtures/plain-html/` 页面注入后断言 `#stylelens-root` 存在、shadowRoot 非空、宿主 `getComputedStyle(document.body).color` 未被插件修改。
- **Dependencies**：1.3、1.4。

### 1.6 Tailwind CSS 4 + shadcn/ui + Shadow DOM 样式隔离预研

- **Objective**：插件 UI 接入 Tailwind CSS 4 + shadcn/ui（仅服务插件 UI，§44 / §71-2）；解决 Shadow DOM 内样式注入策略（预研难点，任务计划书 §7 高风险 ③）。
- **Files**：`apps/extension`（tailwind 配置、`@tailwindcss/vite` 插件、shadcn/ui 初始化）、`src/content/overlay/`（首批 shadcn 组件：Button / Tooltip / Badge）。
- **Acceptance**：Shadow Root 内 shadcn/Tailwind 组件渲染正常（含 hover/focus 态）；宿主页 Tailwind 与插件互不干扰；构建产物样式作用域正确（preflight 不泄漏）。
- **Test cases**：Playwright：宿主页面含同名 class（如 `bg-blue-500`）时插件样式不受影响；插件 Button 的 hover 态在 Shadow DOM 内生效。
- **Dependencies**：1.5。

### 1.7 Playwright 环境 + 冒烟测试

- **Objective**：Playwright 接入；首个 e2e 冒烟：加载扩展 → 注入 overlay → 不污染页面。
- **Files**：`apps/extension/playwright.config.ts`、`tests/e2e/smoke.spec.ts`、`tests/fixtures/` 首批页面。
- **Acceptance**：`pnpm test:e2e` 可跑通 smoke；支持持久化扩展上下文（`--load-extension` / chromium persistent context）。
- **Test cases**：见 1.5 的冒烟断言 + 快捷键注册断言。
- **Dependencies**：1.5、1.6。

### 1.8 Zustand UI 状态机骨架

- **Objective**：按 §61 落地三个 store（SelectionState / AnalysisState / OverlayState）与 UI 状态机（§47：IDLE → SELECTING → SELECTED → ANALYZING → GENERATING → COMPLETED / ERROR）。
- **Files**：`src/content/state/stores.ts`、`src/content/state/machine.ts`、overlay 内状态渲染占位。
- **Acceptance**：状态迁移表（§47）完整；非法迁移被拒绝；ERROR 可回 SELECTING。
- **Test cases**：Vitest 单测状态机全迁移路径 + 非法迁移。
- **Dependencies**：1.5。

### 1.9 官网介绍页 + 拖拽安装按钮（T9）

- **Objective**：一个简单的官网介绍页（本地 `http://127.0.0.1:3001`，由 services/api 静态托管）：产品简介 + **拖拽安装按钮**——用户把按钮/安装文件拖到 `chrome://extensions`（开发者模式）自动安装；同时提供「下载 zip + Load unpacked」备选图文步骤（受 Chrome 安装策略限制时降级，如实呈现）。
- **Files**：`services/api/public/index.html`（介绍页 + 拖拽元素）、`services/api` 静态托管（Hono serveStatic）、`scripts/package-extension.mjs`（构建产物打包 zip；`crx` 因需签名暂不产出）。
- **Acceptance**：本地启动后 `http://127.0.0.1:3001` 显示介绍页；拖拽元素存在且可拖；拖到 `chrome://extensions`（开发者模式）触发安装（若 Chrome 策略不允许拖拽安装，则页面明示降级路径）；「下载 zip」可用。
- **Test cases**：Playwright 断言页面元素与拖拽属性；真实 Chrome 手工验证拖拽安装（记录结论：可行 or 降级）。
- **Dependencies**：1.3（可打包产物）、1.1（services/api 占位）。

---

## 2. Sprint 2 —— Selection

> 目标（§68 Sprint 2）：hover 高亮 → 点击锁定 → Esc/Enter → re-select → 拖拽，形成无 AI 的可交互闭环。
> 退出标准：选择 < 16ms 级交互；点错可立即重选；面板拖拽自由、位置记忆生效。

### 2.1 Hover 高亮

- **Objective**：`mousemove → elementFromPoint()` 定位目标（§59.1），overlay 显示 outline + 半透明遮罩 + 轻量 tooltip（标签名 / class 摘要 / 尺寸，§4.1）；mousemove 只算 rect，不做深层分析（§38）。
- **Files**：`src/content/selector/hover.ts`、`src/content/overlay/HighlightLayer.tsx`。
- **Acceptance**：hover 高亮跟随准确（含 iframe 外边界提示）；tooltip 只含轻量信息；无卡顿（性能采样 < 16ms 级）。
- **Test cases**：Playwright 在 fixtures 各页 hover 不同元素，断言 outline 位置 ≈ 元素 rect；连续快速移动 200 次不产生明显掉帧（performance.mark 采样）。
- **Dependencies**：1.8。

### 2.2 点击锁定 + 控制 UI

- **Objective**：点击后 Hover → Selected（§4.2）：高亮保持、鼠标不再改目标、显示小型控制 UI（`[Analyze] [Re-select] [Component]`，scope 切换 §5）。
- **Files**：`src/content/selector/lock.ts`、`src/content/overlay/SelectionControl.tsx`。
- **Acceptance**：锁定后 mousemove 不改变目标；控制 UI 出现；`[Component]` 可切换 element/component scope（§5）。
- **Test cases**：Playwright：点击后移动鼠标，断言目标不变；切换 scope 断言 AnalysisRequest.scope 正确。
- **Dependencies**：2.1。

### 2.3 键盘 Esc / Enter + 状态机接线

- **Objective**：`Esc` 取消、`Enter` 确认、`Re-select` 重启（§4.3 / §59.1）；SELECTING/SELECTED 状态机接通。
- **Files**：`src/content/selector/keyboard.ts`、状态机接线。
- **Acceptance**：Esc 在任何阶段取消不要求刷新页面；Enter 等价于点击 Analyze；错误选择恢复成本 = 一次按键。
- **Test cases**：Playwright 键盘序列：hover → Esc → 状态回 SELECTING；hover → Enter → 进入 ANALYZING。
- **Dependencies**：2.2。

### 2.4 面板拖拽 + 位置记忆

- **Objective**：结果面板可拖拽（§2.1.1 / §58.3）：初次生成在目标附近自动选位（target rect → nearest safe position → viewport clamp）；用户拖拽后脱离目标（Anchored → Floating），位置记忆到 `stylelens.panelPosition`，后续复用最后位置。
- **Files**：`src/content/overlay/PromptPanel.tsx`（拖拽逻辑）、`src/content/state/overlay-store.ts`、bridge 层 storage 读写。
- **Acceptance**：初次出现不遮挡目标；拖拽自由、不被强制吸附；刷新/重新选择后面板回到用户最后位置；面板不出视口（clamp）。
- **Test cases**：Playwright：生成面板 → 断言初始位置在目标附近；拖拽 → 断言新位置持久化（重新分析后位置不变）；拖出视口 → 断言被 clamp。
- **Dependencies**：2.2。

### 2.5 选择性能校验 + fixtures 选择用例

- **Objective**：验证选择链路性能预算（§66）；把 fixtures 页纳入选择测试矩阵。
- **Files**：`tests/fixtures/**`（首批：plain-html / tailwind / flex-card / grid-layout）、`tests/e2e/selection.spec.ts`。
- **Acceptance**：所有 fixture 页选择交互流畅；hover 高亮无 < 16ms 级卡顿；控制 UI 不遮挡目标元素。
- **Test cases**：四类 fixture 各 5 个元素的选择/重选/取消用例。
- **Dependencies**：2.1–2.4。

---

## 3. Sprint 3 —— StyleProfile

> 目标（§68 Sprint 3）：DOM/CSS/Layout/Context 采集并构建符合 STYLE_PROFILE_SCHEMA 的 StyleProfile。
> 退出标准：fixtures 内 Button/Card 可生成完整 profile；Facts/Inferences 分离；CSSOM 降级不失败；golden 回归起步。

### 3.1 shared types + Zod schemas 落地

- **Objective**：把 STYLE_PROFILE_SCHEMA.md 全部类型翻译为 TS + Zod（单一来源：`apps/extension/src/shared/schemas/`，services/api 通过 workspace 引用）。
- **Files**：`apps/extension/src/shared/schemas/style-profile.ts`、`prompt-options.ts`、`messages.ts`、`src/shared/types.ts`（导出）。
- **Acceptance**：Schema 文档 §18 校验点全部实现；Button 示例 JSON 通过 `safeParse`。
- **Test cases**：Vitest：schema 合法/非法样例；示例 JSON round-trip。
- **Dependencies**：1.4（骨架）、1.1（workspace）。

### 3.2 DOM Snapshot 采集（含脱敏）

- **Objective**：按 §7 采集目标 + 相关节点（限深限宽 §59.2）；文本脱敏规则落地（privacy.ts：限长 120、邮箱/电话/URL token 过滤、input value/password 永不采集）。
- **Files**：`src/content/analyzer/dom.ts`、`src/content/analyzer/privacy.ts`、`src/content/analyzer/snapshot.ts`。
- **Acceptance**：`DOMNodeSnapshot` 字段完整；`TREE_TRUNCATED` / `TEXT_TRUNCATED` warning 正确产生；脱敏单测覆盖全部规则。
- **Test cases**：Vitest：含邮箱/电话/带 token URL 的文本被正确脱敏；`<input type=password>` 无 value 泄漏；深层 DOM 截断。
- **Dependencies**：3.1。

### 3.3 Computed Style + CSSOM 规则溯源（降级链）

- **Objective**：computed style 提取（§8.1 属性清单）；CSSOM 规则溯源（§8.2，document.styleSheets → cssRules → media/supports 处理）；跨域容错走降级（§41），产出 `CROSS_ORIGIN_CSSOM` warning。
- **Files**：`src/content/analyzer/css.ts`、`src/content/analyzer/cssom.ts`。
- **Acceptance**：目标 + 相关节点的关键属性齐全；可读规则能定位 selector/stylesheet/media；跨域 stylesheet 抛降级 warning 而非崩溃；StyleFact.source 正确标注（computed / css-rule）。
- **Test cases**：Vitest + fixture（含跨域 stylesheet 的 fixture 或 mock CSSOM）；Playwright 在 dark-theme fixture 验证 media 规则命中。
- **Dependencies**：3.2。

### 3.4 继承分析 + CSS 变量提取

- **Objective**：区分 Direct / Inherited / Initial / UA（§9），产出 `fontFamilySource` 等继承标记；提取目标及祖先消费的 CSS 变量（§10，CSSVariableUsage）。
- **Files**：`src/content/analyzer/inheritance.ts`、`src/content/analyzer/variables.ts`。
- **Acceptance**：继承属性正确标注来源；变量同时保留 name + resolvedValue；变量定义元素/规则可定位（CSSOM 可读时）。
- **Test cases**：Vitest：body 定义字体/颜色时 Button 的 `fontFamilySource === "inherited"`；`--color-primary` 解析正确。
- **Dependencies**：3.3。

### 3.5 Layout / Flex / Grid / Box Model 分析

- **Objective**：§11 / §12：display/position/positionContext、Flex/Grid 参数、Box Model（含 box-sizing、renderedSize vs layoutSize）、语义化描述生成。
- **Files**：`src/content/analyzer/layout.ts`、`src/content/analyzer/box-model.ts`。
- **Acceptance**：flex-card fixture 输出完整 FlexLayout；grid-layout fixture 输出完整 GridLayout；renderedSize（getBoundingClientRect）与 layoutSize（offsetWidth/Height）区分正确。
- **Test cases**：Vitest + fixtures 断言各布局参数；transform/zoom 场景（fixture 内加入 scale 容器）数值正确。
- **Dependencies**：3.3。

### 3.6 Typography / Visual / Pseudo 元素分析

- **Objective**：§13 排版采集 + 语义角色推断；§14–15 颜色（observed/normalized/token）、表面、边框、圆角、阴影；§16 伪元素分析（::before/::after）。
- **Files**：`src/content/analyzer/typography.ts`、`src/content/analyzer/visual.ts`、`src/content/analyzer/pseudo.ts`。
- **Acceptance**：颜色三元组（observed/normalized/token）齐全；圆角逐角记录；伪元素在可读时采集 content/size/background 并推断用途（icon/decorative-line/badge…）。
- **Test cases**：Vitest + fixtures：含 `::before` 装饰线的组件正确采集；token 颜色解析正确。
- **Dependencies**：3.4、3.5。

### 3.7 Context：Boundary / Theme / Responsive / Shadow DOM / iframe

- **Objective**：§6 / §59.3 Component Boundary 推断（信号：视觉包围、padding 容器、flex/grid 容器、兄弟重复、语义标签、class 命名、aria/role，输出 confidence + evidence）；§21–22 Theme 与 Responsive（colorScheme / matchedMediaQueries / rootFontSize / themeSummary）；§19 Shadow DOM 探测；§20 iframe 识别。
- **Files**：`src/content/analyzer/context.ts`、`src/content/analyzer/boundary.ts`、`src/content/analyzer/theme.ts`。
- **Acceptance**：nested-component fixture 的 Boundary 推断收敛到合理组件（§6.2 示例语义）；shadow-dom fixture 正确标记 shadow boundary；iframe fixture 正确识别跨域边界并 warning。
- **Test cases**：Vitest：boundary 规则单元用例（padding-container、sibling-repetition、semantic-tag）；Playwright：三类 fixture 端到端。
- **Dependencies**：3.2–3.6。

### 3.8 StyleProfile Builder（Facts/Inferences 分离）

- **Objective**：聚合各 Analyzer 输出 → StyleProfile（§60 结构）；normalize / deduplicate（§59.5 collect → normalize → deduplicate → rank）；facts 与 inferences 分类；Zod 校验输出。
- **Files**：`src/content/analyzer/profile-builder.ts`、`src/content/analyzer/rank.ts`。
- **Acceptance**：输出通过 schema 校验；facts 无推断混入、inferences 带 evidence；关键属性（display/position/gap/padding/font/background/border）排序优先于默认属性。
- **Test cases**：Vitest：Button 示例与 golden 对比；属性排序规则单测。
- **Dependencies**：3.2–3.7。

### 3.9 Golden fixtures + 回归机制

- **Objective**：§67.3：为每类 fixture 保存预期 StyleProfile JSON（golden），Analyzer 重构后跑回归防 silent regression。
- **Files**：`tests/fixtures/**/*.golden.json`、`tests/unit/golden.spec.ts`（生成 + 对比脚本）。
- **Acceptance**：golden 生成命令与对比命令齐备；`pnpm test` 含 golden 回归；重构 Analyzer 时 golden 差异可读可审。
- **Test cases**：golden 对比全绿；人为破坏 Analyzer 后回归红（验证有效）。
- **Dependencies**：3.8。

---

## 4. Sprint 4 —— Prompt

> 目标（§68 Sprint 4）：StyleProfile → Compiler → services/api 流式 → 面板展示 → 复制全闭环。
> 退出标准：选择 → 分析 → 流式 → 复制跑通；Prompt 非 CSS dump；§69 AI 类验收满足。

### 4.1 services/api 初始化（Hono + health + 鉴权中间件）

- **Objective**：Hono 服务骨架：`GET /api/health`、共享密钥中间件（MESSAGE_PROTOCOL §5.2）、`X-Trace-Id` 透传、结构化日志；**监听 `127.0.0.1:3001`（用户硬约束：仅本地 localhost，端口 env 可配）**。
- **Files**：`services/api/src/index.ts`、`routes/health.ts`、`middleware/auth.ts`、`package.json`（hono、zod；dev：tsx + vitest）、`.env.example`（`PORT=3001`、`STYLELENS_API_SECRET`）。
- **Acceptance**：`pnpm --filter @stylelens/api dev` 启动并监听 `127.0.0.1:3001`；health 200；无密钥 401；错误密钥 401；正确密钥 200。
- **Test cases**：Vitest（Hono app 单测）：health / auth 三态。
- **Dependencies**：1.1（workspace）。

### 4.2 Provider 抽象 + DeepSeekProvider

- **Objective**：`PromptProvider` 接口（`stream(compiledContext, options): AsyncIterable<string>`）+ `DeepSeekProvider`（OpenAI 兼容 `chat/completions`，模型 `deepseek-chat`，base URL 可配置 env `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`）。
- **Files**：`services/api/src/providers/types.ts`、`deepseek.ts`、`index.ts`、`.env.example`。
- **Acceptance**：provider 返回增量字符串流；错误映射到 MESSAGE_PROTOCOL 错误码（E_PROVIDER_AUTH / RATE_LIMIT / TIMEOUT / STREAM_ERROR）；重试与超时策略生效（首 token 超时默认 30s）。
- **Test cases**：Vitest + mock fetch：正常流 / 401 / 429 / 中途断流 / 超时。
- **Dependencies**：4.1。

### 4.3 `POST /api/prompt/stream` 契约落地

- **Objective**：按 MESSAGE_PROTOCOL §5 实现：body Zod 校验（400 E_INVALID_PAYLOAD）、SSE 事件（prompt_start / chunk / complete / error）、ping 心跳、连接关闭语义。
- **Files**：`services/api/src/routes/prompt-stream.ts`。
- **Acceptance**：curl 验证事件序列正确；非法 body 400；流中断后连接关闭；X-Trace-Id 入日志。
- **Test cases**：Vitest：SSE 事件顺序断言；400 分支；客户端断开时服务端清理。
- **Dependencies**：4.2。

### 4.4 Prompt Compiler

- **Objective**：StyleProfile → LLM Context（§24 / §63.1）：去噪、高价值事实排序（§49.3 优先级：Structure → Layout → Spacing → Typography → Surface → Color → Border → Shadow → Assets → Responsive → State）、层级整理、Facts 与 Inferences 分区、保留 uncertainty。
- **Files**：`services/api/src/compiler/prompt-compiler.ts`（纯函数，与 Extension 解耦，§55.2）。
- **Acceptance**：同一 Button profile 编译出的 context 不含浏览器默认噪声；inferences 带 confidence 标注；输出可被 LLM 直接组织成 Prompt。
- **Test cases**：Vitest：编译器对 golden profiles 的输出快照；去噪规则单测。
- **Dependencies**：4.2（compiler 位置在 api 内，也可先行独立）、3.1（类型）。

### 4.5 Prompt 输出模板

- **Objective**：按 §25 章节结构定义 Prompt 输出格式（Goal / Component Context / Structure / Layout / Spacing / Typography / Colors & Surfaces / Borders & Shadows / Assets / Responsive / Interaction States / Implementation Requirements / Fidelity Requirements）；框架无关默认（§27 / §26 核心指令：`Prioritize visual fidelity over source-code similarity`）。
- **Files**：`services/api/src/compiler/templates.ts`、`prompt.ts`（system prompt + user prompt 组装）。
- **Acceptance**：模板覆盖 §25 全部章节；`targetFramework` 切换只改变 Implementation Requirements 部分；语言固定英文（T5：MVP 不做中文切换）。
- **Test cases**：Vitest：模板渲染断言（章节存在、框架切换差异、语言切换）。
- **Dependencies**：4.4。

### 4.6 Content 侧流式链路

- **Objective**：background `ai-client.ts` 发起 POST 到 **`http://127.0.0.1:3001/api/prompt/stream`（仅 localhost，设置 `apiBaseUrl` 默认值）**（携带共享密钥配置）→ SSE 消费 → `PROMPT_CHUNK` 转发 → Content Zustand update → 面板渲染（buffer + rAF 批量，§37）；`ANALYSIS_START` 隐含取消旧流（AbortController）。
- **Files**：`apps/extension/src/background/ai-client.ts`、`src/content/bridge/stream.ts`、`src/content/state/analysis-store.ts`、`src/content/overlay/PromptViewer.tsx`。
- **Acceptance**：首 chunk 到 UI < 1s（本地后端）；流式渲染无卡顿（每帧最多一次 DOM 更新）；中途取消后无残留请求。
- **Test cases**：Playwright + 本地 mock 后端：事件序列渲染；取消场景断言 AbortController 触发。
- **Dependencies**：4.3、1.8。

### 4.7 面板：自动滚动 / 复制 / 错误态 / 重试

- **Objective**：§29 / §64：生成中自动滚动到底、用户上滚停止跟随（恢复时提示）、完成后启用 Copy（`navigator.clipboard`，轻量反馈 §64.2）、错误态（MESSAGE_PROTOCOL 错误码映射）+ Retry、面板状态机（§48 Hidden/Anchored/Generating/Streaming/Complete/Floating）。
- **Files**：`src/content/overlay/PromptPanel.tsx`、`src/content/overlay/ErrorState.tsx`、`src/content/overlay/CopyButton.tsx`。
- **Acceptance**：流式时自动滚动、手动上滚后不再强制；Copy 成功有反馈不弹 Dialog；全部错误码有对应 UI 文案；Retry 可重新发起。
- **Test cases**：Playwright：流式滚动行为；clipboard 写入成功（权限内）；错误注入（后端 401 / 断连）→ 错误态 → Retry。
- **Dependencies**：4.6。

### 4.8 流式体验验收

- **Objective**：全链路体验验收：选择 → 分析 → 流式 → 复制（§68 Sprint 4 交付物）；DeepSeek 真实调用冒烟。
- **Files**：`tests/e2e/prompt-flow.spec.ts`、验收记录（临时 checklist）。
- **Acceptance**：真实 DeepSeek 调用下闭环完整；生成中面板无空白大面板（第一时间显示 "Analyzing component…"，§28）；§69 AI 类验收逐条通过（Prompt 非 CSS dump、说明布局/视觉/上下文、可直接粘贴主流 coding model）。
- **Test cases**：e2e 全流程 + 3 个真实组件人工验证。
- **Dependencies**：4.7。

---

## 5. Sprint 5 —— Quality

> 目标（§68 Sprint 5）：benchmark 与回归体系，§69 验收门槛全达标。
> 退出标准：10 组件 benchmark 通过；无页面性能明显回归；核心 analyzer 有回归 fixture。

### 5.1 10 组件 fixtures + benchmark 记录流程

- **Objective**：建设 10 组件 benchmark 清单（§42 精简版）与记录流程（Original Screenshot → DOM → StyleProfile → Prompt → AI Reimplementation → Similarity Score，§50 Phase 4 简化版）。
- **Files**：`tests/fixtures/benchmark/`（button / card / navbar / form / input / badge / tabs / search-bar / product-card / footer-section 各一个页面）、`tests/benchmark/README.md`（记录模板）、`scripts/benchmark.mjs`（截图 + profile + prompt 采集脚本）。
- **Acceptance**：10 个组件页面就绪；benchmark 记录模板完整；脚本可一键产出每个组件的截图 + StyleProfile + Prompt。
- **Test cases**：脚本 dry-run 对 10 组件全部成功。
- **Dependencies**：4.8。

### 5.2 Playwright e2e 全场景

- **Objective**：§67.2：selection / overlay 不污染 / drag 稳定 / prompt 完整 / copy 成功，覆盖全部 fixtures 类型。
- **Files**：`tests/e2e/*.spec.ts`（selection / overlay-isolation / drag / prompt-flow / copy）。
- **Acceptance**：全场景在 CI（`pnpm test:e2e`）绿；fixtures 九类目录均有用例。
- **Test cases**：见各 spec 描述。
- **Dependencies**：5.1。

### 5.3 性能 profiling + 优化

- **Objective**：§66 预算验证：selection < 16ms 级、snapshot < 100ms、profile build < 500ms（常规组件）；优化热点（stylesheet 缓存、children 截断、临时对象释放）。
- **Files**：`tests/benchmark/perf.md`（测量记录）、analyzer 内性能修复。
- **Acceptance**：预算逐项达标或有明确超预算记录 + 修复方案；大页面（deep-dom fixture）无卡顿。
- **Test cases**：performance.mark 采样断言；deep-dom fixture 端到端。
- **Dependencies**：5.2。

### 5.4 隐私脱敏审计 + 加固

- **Objective**：§39 / §65.2 审计：发送链路（Raw → Normalize → Filter → Context）检查；脱敏单测补全；确保无 password/input value/token 泄漏路径。
- **Files**：`src/content/analyzer/privacy.ts`（加固）、`tests/unit/privacy.spec.ts`（扩展）、审计记录。
- **Acceptance**：审计清单全绿；脱敏规则 100% 单测覆盖；无已知泄漏路径。
- **Test cases**：含敏感内容的 fixture 页面全链路断言「永不发送清单」未出现在任何消息/请求中。
- **Dependencies**：5.2。

### 5.5 benchmark 评测执行 + 迭代修复

- **Objective**：10 组件逐个跑「选择 → Prompt → 交给另一个 AI 重建 → 相似度评分」；按证据迭代 Analyzer/Compiler（§43 Q1–Q5 指标记录）。
- **Files**：`tests/benchmark/results/`（评分记录）、迭代修复 commit。
- **Acceptance**：10/10 组件可生成可用 Prompt；主要组件（Button/Card/Navbar/Form）重建相似度达到「可辨识」基线；记录 North Star 指标（Visual Reconstruction Fidelity）初值。
- **Test cases**：每个组件一份评分卡。
- **Dependencies**：5.1–5.4。

### 5.6 §69 验收门槛核对 + 已知问题清单

- **Objective**：逐条核对 §69 四类验收（Product / Analyzer / AI / Engineering），输出已知问题与后续路线。
- **Files**：`docs/MVP_ACCEPTANCE_CHECKLIST.md`（新增，逐条核对结果）。
- **Acceptance**：§69 全部条目有结论（通过 / 不通过 + 原因）；已知问题清单形成；MVP 可宣布完成或明确剩余项。
- **Test cases**：核对过程即验证过程（引用各 sprint 测试结果）。
- **Dependencies**：5.5。

---

## 6. 10 组件 Benchmark 清单（§42 精简版）

| # | 组件 | 建议 fixture 要点 |
|---|---|---|
| 1 | Button | 含 icon + label；primary/ghost 变体 |
| 2 | Card | 图片 + 标题 + 描述 + footer 按钮（含阴影/圆角） |
| 3 | Navbar | 多链接 + logo + CTA（flex 布局） |
| 4 | Form | label + input + select + submit（继承排版重点） |
| 5 | Input | 含 focus 态样式、placeholder |
| 6 | Badge | 色彩 token + 圆角 + 文本 |
| 7 | Tabs | 激活态样式（含 ::after 指示线候选） |
| 8 | Search Bar | icon 伪元素 + 圆角 + 边框 |
| 9 | Product Card | 图 + 价格 + 按钮（grid 布局） |
| 10 | Footer Section | 多列 grid + 链接列表（「这个区域」预演） |

> 每个组件记录：Original Screenshot / Original DOM / StyleProfile / Generated Prompt / AI Reimplementation / Similarity Score（§50 Phase 4 简化）。10 起步，Phase 4 扩至 20–50（§42 全清单）。

---

## 7. Fixtures 目录（§67.2）

```text
tests/fixtures/
├── plain-html/        # 无框架裸 HTML
├── tailwind/          # Tailwind class 页面
├── flex-card/         # flex 卡片
├── grid-layout/       # grid 布局
├── nested-component/  # 深层嵌套组件（boundary 推断重点）
├── dark-theme/        # dark color scheme + media query
├── responsive/        # 多断点布局
├── shadow-dom/        # 含 closed/open shadow root 组件
├── iframe/            # 含同源/跨源 iframe
└── benchmark/         # 10 组件 benchmark 页面
```

---

## 8. 验收门槛映射（§69 → Sprint）

| §69 类别 | 条目 | 验收 Sprint |
|---|---|---|
| Product | 用户 5 秒内理解如何开始 | Sprint 2（控制 UI）+ Sprint 5 核对 |
| Product | 点击错元素可立即重选 | Sprint 2（2.3） |
| Product | 面板可自由拖动 | Sprint 2（2.4） |
| Product | 面板不破坏原网页布局 | Sprint 1（1.5/1.7 隔离测试） |
| Analyzer | Button/Card/Input/Navbar/Modal 稳定分析 | Sprint 3（golden）+ Sprint 5（benchmark） |
| Analyzer | 正确识别主要布局上下文 | Sprint 3（3.5/3.7） |
| Analyzer | 区分 computed fact 与 inference | Sprint 3（3.8） |
| Analyzer | CSS variable 可被解释 | Sprint 3（3.4） |
| AI | Prompt 不只是 CSS dump | Sprint 4（4.4/4.5） |
| AI | Prompt 说明布局、视觉和上下文 | Sprint 4（4.5 模板章节） |
| AI | Prompt 可直接复制到主流 coding model | Sprint 4（4.8 验收） |
| Engineering | Shadow DOM 隔离通过测试 | Sprint 1（1.6/1.7） |
| Engineering | Chrome MV3 lifecycle 正常 | Sprint 1（1.3/1.4） |
| Engineering | 无明显页面性能回归 | Sprint 5（5.3） |
| Engineering | 核心 analyzer 有 regression fixture | Sprint 3（3.9）+ Sprint 5 |

---

## 9. 任务依赖图（概要）

```text
Sprint 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7
                    └──────────────→ 1.8（依赖 1.5）
                    1.3 ─────────────→ 1.9（官网介绍页，依赖 1.3/1.1）
Sprint 2: 2.1 → 2.2 → 2.3 → 2.4 ──→ 2.5（汇总验收）
Sprint 3: 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9
                 └→（3.3/3.4 可并行推进，但按序更稳）
Sprint 4: 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7 → 4.8
                 └→（4.4/4.5 与 4.2/4.3 可并行）
Sprint 5: 5.1 → 5.2 → 5.3/5.4（并行）→ 5.5 → 5.6
```

---

## 10. 给执行 Agent 的执行约定

1. **文档先行**：每个任务开工前，先读 `STYLE_PROFILE_SCHEMA.md` / `MESSAGE_PROTOCOL.md` 相关章节；协议是契约，代码是实现。
2. **测试同行**：每个任务必须带测试（单测或 e2e），验收标准即测试断言。
3. **契约变更纪律**：改动消息/Schema 形状必须同步三份配套文档并跑 golden 回归（STYLE_PROFILE_SCHEMA §20、MESSAGE_PROTOCOL §11）。
4. **性能红线**（§66）：hover 只算 rect；分析只覆盖必要节点；mousemove 禁止深层计算。
5. **隐私红线**（§39 / §65.2）：password / input value / token 永不进入消息与请求，写单测锁定。
6. **提交粒度**：一个任务一个 commit（或一组小 commit），commit message 含任务编号（如 `sprint3: 3.4 css variable extraction`）。
