import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { launchExtensionContext, sendToActiveTab, shadowText } from './helpers'

const COMPONENTS = [
  { name: 'button', path: '/benchmark/button/', selector: '.btn' },
  { name: 'card', path: '/benchmark/card/', selector: '.card' },
  { name: 'navbar', path: '/benchmark/navbar/', selector: 'nav' },
  { name: 'form', path: '/benchmark/form/', selector: 'form' },
  { name: 'input', path: '/benchmark/input/', selector: 'input' },
  { name: 'badge', path: '/benchmark/badge/', selector: '.badge' },
  { name: 'tabs', path: '/benchmark/tabs/', selector: '.tabs' },
  { name: 'search-bar', path: '/benchmark/search-bar/', selector: '.search' },
  { name: 'product-card', path: '/benchmark/product-card/', selector: '.product' },
  { name: 'footer-section', path: '/benchmark/footer-section/', selector: 'footer' },
]

const RESULTS_DIR = resolve(fileURLToPath(new URL('../benchmark/results', import.meta.url)))

test.describe('benchmark matrix (10 components, §42 / §68 Sprint 5)', () => {
  let context: BrowserContext
  let cleanup: () => Promise<void>

  test.beforeAll(async () => {
    ;({ context, cleanup } = await launchExtensionContext())
  })

  test.afterAll(async () => {
    await cleanup()
  })

  for (const c of COMPONENTS) {
    test(`analyzes ${c.name} end-to-end`, async () => {
      const page = await context.newPage()
      const t0 = Date.now()

      await page.goto(c.path)
      await sendToActiveTab(context, page, { type: 'SELECTION_START' })
      const box = await page.locator(c.selector).first().boundingBox()
      expect(box).not.toBeNull()
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.evaluate(() => {
        const host = document.getElementById('stylelens-root')
        const ctrl = host?.shadowRoot?.getElementById('stylelens-selection-control')
        const btnEl = Array.from(ctrl?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Analyze')
        ;(btnEl as HTMLButtonElement)?.click()
      })

      // 流式 Prompt 输出（mock 后端）
      await expect
        .poll(async () => shadowText(page, 'stylelens-prompt-panel'))
        .toContain('# Recreate This UI Component')
      const totalMs = Date.now() - t0

      const worker = context.serviceWorkers()[0]
      const profile = (await worker!.evaluate(
        () => (globalThis as Record<string, unknown>).__stylelensLastProfile,
      )) as { facts: unknown[]; warnings: unknown[]; context: { componentBoundary?: unknown } }

      expect(profile).toBeTruthy()
      expect(profile.facts.length).toBeGreaterThan(5)
      expect(Array.isArray(profile.warnings)).toBe(true)

      // §66 宽松预算：整个闭环（导航→选择→分析→流式完成）在 e2e 开销下 < 5s
      expect(totalMs).toBeLessThan(5000)

      // 记录 benchmark 产物（BENCHMARK_CAPTURE=1 时）：截图 + StyleProfile + Prompt
      if (process.env.BENCHMARK_CAPTURE) {
        const dir = resolve(RESULTS_DIR, c.name)
        mkdirSync(dir, { recursive: true })
        await page.screenshot({ path: resolve(dir, 'original.png') })
        const promptText = await shadowText(page, 'stylelens-prompt-panel')
        writeFileSync(resolve(dir, 'profile.json'), JSON.stringify(profile, null, 2))
        writeFileSync(resolve(dir, 'prompt.md'), promptText)
        writeFileSync(
          resolve(dir, 'meta.json'),
          JSON.stringify({ name: c.name, totalMs, capturedAt: new Date().toISOString() }, null, 2),
        )
        console.log(`[benchmark] captured ${c.name} (${totalMs}ms)`)
      }
    })
  }
})
