import { expect, test, type BrowserContext } from '@playwright/test'
import { launchExtensionContext, sendToActiveTab, shadowText } from './helpers'

test.describe('StyleLens extension smoke', () => {
  let context: BrowserContext
  let cleanup: () => Promise<void>

  test.beforeAll(async () => {
    ;({ context, cleanup } = await launchExtensionContext())
  })

  test.afterAll(async () => {
    await cleanup()
  })

  test('content script mounts overlay in shadow root without polluting the page', async () => {
    const page = await context.newPage()
    await page.goto('/plain-html/')

    const host = page.locator('#stylelens-root')
    await expect(host).toHaveCount(1)
    expect(await host.evaluate((el) => Boolean(el.shadowRoot))).toBe(true)

    // 宿主样式未被插件污染：body color 保持 fixture 值
    const bodyColor = await page.evaluate(() => getComputedStyle(document.body).color)
    expect(bodyColor).toBe('rgb(17, 17, 17)')

    // 插件 UI 渲染了 StyleLens 标识（Shadow Root 内）
    expect(await shadowText(page, 'stylelens-mount')).toContain('StyleLens')
  })

  test('SELECTION_START switches overlay to selecting state', async () => {
    const page = await context.newPage()
    await page.goto('/plain-html/')
    await sendToActiveTab(context, page, { type: 'SELECTION_START' })

    // 进入 selecting 后，角落状态芯片隐藏、hover 层就绪（控制条为空）
    await expect
      .poll(async () => shadowText(page, 'stylelens-selection-control'))
      .toBe('')
  })
})
