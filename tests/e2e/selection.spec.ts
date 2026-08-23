import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { launchExtensionContext, sendToActiveTab, shadowStyle, shadowText } from './helpers'

test.describe('StyleLens selection (Sprint 2)', () => {
  let context: BrowserContext
  let cleanup: () => Promise<void>

  test.beforeAll(async () => {
    ;({ context, cleanup } = await launchExtensionContext())
  })

  test.afterAll(async () => {
    await cleanup()
  })

  async function openInSelectMode(page: Page, path: string) {
    await page.goto(path)
    await sendToActiveTab(context, page, { type: 'SELECTION_START' })
    // 等待进入 selecting 态（状态芯片消失 / 控制条不可见）
    await expect
      .poll(async () => shadowText(page, 'stylelens-selection-control'))
      .toBe('')
  }

  test('hover highlights the element under the cursor', async () => {
    const page = await context.newPage()
    await openInSelectMode(page, '/flex-card/')

    // 按钮无子元素：elementFromPoint 返回按钮本身，outline 应与按钮 rect 一致
    const box = await page.locator('.toolbar button').boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.waitForTimeout(120)

    const outline = await shadowStyle(page, 'stylelens-hover-outline')
    expect(outline.display).toBe('block')
    expect(parseFloat(outline.left)).toBeCloseTo(box!.x, 0)
    expect(parseFloat(outline.top)).toBeCloseTo(box!.y, 0)
    expect(parseFloat(outline.width)).toBeCloseTo(box!.width, 0)

    const tooltip = await shadowText(page, 'stylelens-tooltip')
    expect(tooltip).toContain('<button>')
  })

  test('click locks the target and shows control UI; Analyze opens panel', async () => {
    const page = await context.newPage()
    await openInSelectMode(page, '/flex-card/')

    const btn = await page.locator('.toolbar button').boundingBox()
    await page.mouse.click(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2)
    await page.waitForTimeout(120)

    const control = await shadowText(page, 'stylelens-selection-control')
    expect(control).toContain('Analyze')
    expect(control).toContain('Re-select')
    expect(control).toContain('Component')

    // Analyze → 面板出现并显示 Analyzing
    await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const ctrl = host?.shadowRoot?.getElementById('stylelens-selection-control')
      const btnEl = Array.from(ctrl?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Analyze')
      ;(btnEl as HTMLButtonElement)?.click()
    })
    await expect
      .poll(async () => shadowText(page, 'stylelens-prompt-panel'))
      .toContain('Analyzing component')
  })

  test('Esc cancels selection; Re-select returns to selecting', async () => {
    const page = await context.newPage()
    await openInSelectMode(page, '/plain-html/')

    const btn = await page.locator('.btn').boundingBox()
    await page.mouse.click(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2)
    await expect
      .poll(async () => shadowText(page, 'stylelens-selection-control'))
      .toContain('Analyze')

    // Esc → 取消（控制条消失，回到 idle）
    await page.keyboard.press('Escape')
    await expect
      .poll(async () => shadowText(page, 'stylelens-selection-control'))
      .toBe('')

    // 重新进入选择 → Re-select 流程
    await sendToActiveTab(context, page, { type: 'SELECTION_START' })
    await page.mouse.click(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2)
    await expect
      .poll(async () => shadowText(page, 'stylelens-selection-control'))
      .toContain('Analyze')
    await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const ctrl = host?.shadowRoot?.getElementById('stylelens-selection-control')
      const btnEl = Array.from(ctrl?.querySelectorAll('button') ?? []).find((b) => b.textContent === 'Re-select')
      ;(btnEl as HTMLButtonElement)?.click()
    })
    // Re-select 后再次 hover 应恢复高亮（selecting 态）
    const h1 = await page.locator('h1').boundingBox()
    await page.mouse.move(h1!.x + 20, h1!.y + 10)
    await page.waitForTimeout(120)
    const outline = await shadowStyle(page, 'stylelens-hover-outline')
    expect(outline.display).toBe('block')
  })

  test('panel drags freely and persists position (Floating)', async () => {
    const page = await context.newPage()
    await openInSelectMode(page, '/plain-html/')
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
      .toContain('Analyzing')

    const before = await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const panel = host?.shadowRoot?.getElementById('stylelens-prompt-panel')
      return panel ? { left: panel.style.left, top: panel.style.top } : null
    })
    expect(before).not.toBeNull()

    // 拖拽把手
    const header = await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const h = host?.shadowRoot?.getElementById('stylelens-panel-header')
      if (!h) return null
      const r = h.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    expect(header).not.toBeNull()
    await page.mouse.move(header!.x, header!.y)
    await page.mouse.down()
    await page.mouse.move(header!.x + 120, header!.y + 80, { steps: 5 })
    await page.mouse.up()

    const after = await page.evaluate(() => {
      const host = document.getElementById('stylelens-root')
      const panel = host?.shadowRoot?.getElementById('stylelens-prompt-panel')
      return panel ? { left: panel.style.left, top: panel.style.top } : null
    })
    expect(parseFloat(after!.left)).toBeGreaterThan(parseFloat(before!.left))
    expect(parseFloat(after!.top)).toBeGreaterThan(parseFloat(before!.top))
  })
})
