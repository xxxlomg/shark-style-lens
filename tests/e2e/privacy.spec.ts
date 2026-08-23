import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { launchExtensionContext, sendToActiveTab, shadowText } from './helpers'

test.describe('StyleLens privacy (Sprint 5, §39 / §65.2)', () => {
  let context: BrowserContext
  let cleanup: () => Promise<void>

  test.beforeAll(async () => {
    ;({ context, cleanup } = await launchExtensionContext())
  })

  test.afterAll(async () => {
    await cleanup()
  })

  test('profile and prompt never contain sensitive data', async () => {
    const page = await context.newPage()
    await page.goto('/privacy/')
    await sendToActiveTab(context, page, { type: 'SELECTION_START' })

    const btn = await page.locator('.btn').boundingBox()
    await page.mouse.click(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2)
    await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const ctrl = host?.shadowRoot?.getElementById('stylelens-selection-control')
      const btnEl = Array.from(ctrl?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Analyze')
      ;(btnEl as HTMLButtonElement)?.click()
    })
    await expect
      .poll(async () => shadowText(page, 'stylelens-prompt-panel'))
      .toContain('# Recreate This UI Component')

    const worker = context.serviceWorkers()[0]
    const profile = await worker!.evaluate(
      () => (globalThis as Record<string, unknown>).__stylelensLastProfile,
    )
    const json = JSON.stringify(profile)

    // 永不发送清单（§39 / §65.2）：email / 电话 / token / 密码 / 卡号 / input value
    expect(json).not.toContain('alice.wang@example.com')
    expect(json).not.toContain('202-555-0168')
    expect(json).not.toContain('super-secret-token')
    expect(json).not.toContain('p@ssw0rd')
    expect(json).not.toContain('4111')

    // Prompt 同样不含敏感内容（Compiler 输入已脱敏）
    const promptText = await shadowText(page, 'stylelens-prompt-panel')
    expect(promptText).not.toContain('alice.wang@example.com')
    expect(promptText).not.toContain('p@ssw0rd')
  })
})
