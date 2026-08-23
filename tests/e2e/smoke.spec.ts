import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'

const extPath = resolve(fileURLToPath(new URL('../../apps/extension/dist', import.meta.url)))

test.describe('StyleLens extension smoke', () => {
  let context: BrowserContext
  let userDataDir: string

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'stylelens-e2e-'))
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
    })
  })

  test.afterAll(async () => {
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
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
    const chipText = await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      return host?.shadowRoot?.textContent ?? ''
    })
    expect(chipText).toContain('StyleLens')
  })

  test('SELECTION_START switches overlay to selecting state', async () => {
    const page = await context.newPage()
    await page.goto('/plain-html/')

    // 通过扩展 Service Worker 向当前活动标签页发送 SELECTION_START（等价于 popup 按钮）
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'SELECTION_START' })
    })

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const host = document.getElementById('stylelens-root')
          return host?.shadowRoot?.textContent ?? ''
        }),
      )
      .toContain('selecting')
  })
})
