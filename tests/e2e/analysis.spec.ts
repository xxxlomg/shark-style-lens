import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { launchExtensionContext, sendToActiveTab, shadowText } from './helpers'

const GOLDEN_PATH = resolve(
  fileURLToPath(new URL('../fixtures/golden/plain-html-button.golden.json', import.meta.url)),
)

test.describe('StyleLens analysis (Sprint 3)', () => {
  let context: BrowserContext
  let cleanup: () => Promise<void>

  test.beforeAll(async () => {
    ;({ context, cleanup } = await launchExtensionContext())
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  test.afterAll(async () => {
    await cleanup()
  })

  async function selectAndAnalyze(page: Page, path: string, selector: string) {
    await page.goto(path)
    await sendToActiveTab(context, page, { type: 'SELECTION_START' })
    const box = await page.locator(selector).boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const ctrl = host?.shadowRoot?.getElementById('stylelens-selection-control')
      const btnEl = Array.from(ctrl?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Analyze')
      ;(btnEl as HTMLButtonElement)?.click()
    })
    await expect
      .poll(async () => shadowText(page, 'stylelens-prompt-panel'))
      .toContain('# Recreate This UI Component')
  }

  async function lastProfile(): Promise<Record<string, unknown>> {
    const worker = context.serviceWorkers()[0]
    expect(worker).toBeTruthy()
    return worker!.evaluate(() => (globalThis as Record<string, unknown>).__stylelensLastProfile as Record<string, unknown>)
  }

  test('builds a full StyleProfile for the plain-html button (golden)', async () => {
    const page = await context.newPage()
    await selectAndAnalyze(page, '/plain-html/', '.btn')

    const profile = await lastProfile()
    expect(profile).toBeTruthy()
    expect((profile.target as { tagName: string }).tagName).toBe('button')

    // Facts 含关键 computed 属性（§8.1 / §59.5）
    const facts = profile.facts as Array<{ property: string; value: string; source: string }>
    expect(facts.find((f) => f.property === 'display')?.value).toBe('inline-flex')
    expect(facts.find((f) => f.property === 'background-color')?.value).toBe('rgb(99, 102, 241)')
    // Inferences 带证据（§60.1）
    expect(Array.isArray(profile.inferences)).toBe(true)
    // 关键字段齐全
    for (const key of ['version', 'target', 'context', 'structure', 'layout', 'spacing', 'typography', 'visual', 'assets', 'responsive', 'states', 'facts', 'inferences', 'warnings']) {
      expect(profile).toHaveProperty(key)
    }

    if (process.env.GOLDEN_CAPTURE) {
      mkdirSync(dirname(GOLDEN_PATH), { recursive: true })
      writeFileSync(GOLDEN_PATH, JSON.stringify(profile, null, 2))
      console.log(`[golden] captured → ${GOLDEN_PATH}`)
    } else if (existsSync(GOLDEN_PATH)) {
      // Golden 回归（§67.3）：结构稳定字段必须逐字节一致
      const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf-8')) as Record<string, unknown>
      expect(profile.facts).toEqual(golden.facts)
      expect(profile.context).toEqual(golden.context)
      expect(profile.typography).toEqual(golden.typography)
      expect(profile.layout).toEqual(golden.layout)
      expect(profile.visual).toEqual(golden.visual)
    }
  })

  test('streams a prompt end-to-end and copies it (Sprint 4, mock backend)', async () => {
    const page = await context.newPage()
    await selectAndAnalyze(page, '/plain-html/', '.btn')

    // mock provider 流式输出 Compiler 渲染的 §25 markdown
    await expect
      .poll(async () => shadowText(page, 'stylelens-prompt-panel'))
      .toContain('# Recreate This UI Component')

    // Copy 按钮启用 → 点击 → 轻量反馈（§64.2）
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const host = document.getElementById('stylelens-root')
          const panel = host?.shadowRoot?.getElementById('stylelens-prompt-panel')
          const btn = Array.from(panel?.querySelectorAll('button') ?? []).find((b) =>
            b.textContent?.includes('Copy'),
          )
          return btn ? !(btn as HTMLButtonElement).disabled : false
        }),
      )
      .toBe(true)
    await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const panel = host?.shadowRoot?.getElementById('stylelens-prompt-panel')
      const btn = Array.from(panel?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes('Copy'))
      ;(btn as HTMLButtonElement)?.click()
    })
    await expect
      .poll(async () => shadowText(page, 'stylelens-prompt-panel'))
      .toContain('Copied')

    // 剪贴板内容 = 生成的 Prompt
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('# Recreate This UI Component')
  })

  test('degrades gracefully on cross-origin stylesheet (CROSS_ORIGIN_CSSOM warning)', async () => {
    const page = await context.newPage()
    // cross-origin fixture 通过 <link> 加载跨域 stylesheet（§8.2 安全限制场景）
    await selectAndAnalyze(page, '/cross-origin/', 'button')

    const profile = await lastProfile()
    expect(profile).toBeTruthy()
    const warnings = profile.warnings as Array<{ code: string }>
    expect(warnings.some((w) => w.code === 'CROSS_ORIGIN_CSSOM')).toBe(true)
    // 降级后仍输出完整 profile（§41）
    expect((profile.facts as unknown[]).length).toBeGreaterThan(5)
  })
})
