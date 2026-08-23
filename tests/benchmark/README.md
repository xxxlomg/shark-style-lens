# StyleLens Benchmark

10 组件基准（§42 精简版 / §68 Sprint 5）。每组件通过扩展真实分析生成：
`original.png`（原始截图）、`profile.json`（StyleProfile）、`prompt.md`（生成 Prompt）、`meta.json`（耗时等）。

## 重新采集

```bash
pnpm --filter @stylelens/extension build
cd apps/extension
BENCHMARK_CAPTURE=1 pnpm exec playwright test --grep benchmark
```

## 视觉重建评测流程（North Star：Visual Reconstruction Fidelity，§43 / §50 Phase 4）

对每个组件：

1. 将 `prompt.md` 粘贴到目标 AI 编程工具（Cursor / Claude Code / ChatGPT / Gemini）。
2. 在隔离项目中让 AI 按 Prompt 重建组件。
3. 打开重建结果与 `original.png` 并排对比，按以下维度打分（1–5）：

| 维度 | 说明 |
|---|---|
| Visual hierarchy | 主次层级是否一致 |
| Spacing & proportion | 间距、尺寸比例 |
| Typography | 字体、字号、字重、行高 |
| Color & surface | 颜色、表面处理 |
| Border / radius / shadow | 边框、圆角、阴影 |
| Layout behavior | 布局行为（flex/grid） |
| Responsive intent | 响应式意图 |

4. 总分 = 平均分；记录到 `results/<name>/score.md`。

## 已捕获结果

| 组件 | 闭环耗时 | 备注 |
|---|---|---|
| button | ~300ms | 含 icon + primary/ghost 变体 |
| card | ~350ms | 图片 + 价格 + CTA（shadow） |
| navbar | ~260ms | flex 导航 + CTA |
| form | ~270ms | label + input + submit（继承排版） |
| input | ~260ms | focus 态 + placeholder |
| badge | ~250ms | 色彩 token + 圆角胶囊 |
| tabs | ~265ms | active 态 + ::after 指示线 |
| search-bar | ~290ms | icon + 圆角 + ⌘K 键帽 |
| product-card | ~275ms | grid 三列 + 卡片 |
| footer-section | ~475ms | 四列 grid + 链接列表 |

> 注：当前结果使用 Mock provider（无 DEEPSEEK_API_KEY）；接入 DeepSeek 后重建评分需人工执行并更新本表。
