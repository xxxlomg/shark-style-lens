import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from '@playwright/test'

export const extPath = resolve(fileURLToPath(new URL('../../apps/extension/dist', import.meta.url)))

export interface ExtensionContext {
  context: BrowserContext
  cleanup: () => Promise<void>
}

/** 启动带扩展的持久化上下文（bundled Chromium，品牌版 Chrome 在自动化模式拒绝 --load-extension） */
export async function launchExtensionContext(): Promise<ExtensionContext> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'stylelens-e2e-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  })
  return {
    context,
    cleanup: async () => {
      await context.close()
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }
}

/** 通过扩展 SW 向当前活动标签页发送消息（等价 popup 按钮行为） */
export async function sendToActiveTab(
  context: BrowserContext,
  page: Page,
  message: unknown,
): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  await worker.evaluate(async (msg) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, msg)
  }, message)
}

/** 读取 Shadow Root 内元素的文本（按 id） */
export async function shadowText(page: Page, id: string): Promise<string> {
  return page.evaluate((elId) => {
    const host = document.getElementById('stylelens-root')
    const el = host?.shadowRoot?.getElementById(elId)
    return el?.textContent ?? ''
  }, id)
}

/** 读取 Shadow Root 内元素的内联样式（按 id） */
export async function shadowStyle(page: Page, id: string): Promise<Record<string, string>> {
  return page.evaluate((elId) => {
    const host = document.getElementById('stylelens-root')
    const el = host?.shadowRoot?.getElementById(elId)
    if (!el) return {}
    const s = el.style
    return {
      display: s.display,
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
    }
  }, id)
}
