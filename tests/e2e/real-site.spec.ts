import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { launchExtensionContext, sendToActiveTab, shadowText } from './helpers'

/**
 * 真实外部站点验证（用户反馈「在真实页面无法使用」）：
 * content script 必须在普通互联网页面上正常注入并进入选择模式。
 */
test.describe('StyleLens on a real external site', () => {
  let context: BrowserContext
  let cleanup: () => Promise<void>

  test.beforeAll(async () => {
    ;({ context, cleanup } = await launchExtensionContext())
  })

  test.afterAll(async () => {
    await cleanup()
  })

  test('injects overlay and starts selection on https://example.com', async () => {
    const page: Page = await context.newPage()
    await page.goto('https://example.com/')

    // 注入成功：宿主元素 + Shadow Root 存在
    const host = page.locator('#stylelens-root')
    await expect(host).toHaveCount(1)
    expect(await host.evaluate((el) => Boolean(el.shadowRoot))).toBe(true)

    // 空闲态芯片可见
    expect(await shadowText(page, 'stylelens-mount')).toContain('StyleLens')

    // SELECTION_START → 进入选择模式（hover 层就绪）
    await sendToActiveTab(context, page, { type: 'SELECTION_START' })
    await expect
      .poll(async () => shadowText(page, 'stylelens-selection-control'))
      .toBe('')

    // 真实页面上 hover 任意链接 → 高亮出现
    const link = await page.locator('a').first().boundingBox()
    expect(link).not.toBeNull()
    await page.mouse.move(link!.x + link!.width / 2, link!.y + link!.height / 2)
    await page.waitForTimeout(150)
    const outline = await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const o = host?.shadowRoot?.getElementById('stylelens-hover-outline')
      return o ? { display: o.style.display, left: o.style.left, top: o.style.top } : null
    })
    expect(outline?.display).toBe('block')
    expect(parseFloat(outline!.left)).toBeGreaterThanOrEqual(0)
  })
})
