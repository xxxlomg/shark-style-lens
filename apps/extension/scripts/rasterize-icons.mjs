import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const svg = await readFile(new URL('../public/stylelens-icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()

try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    await page.setContent(
      `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden">${svg}</body></html>`,
    )
    await page.locator('svg').evaluate((element, value) => {
      element.setAttribute('width', String(value))
      element.setAttribute('height', String(value))
    }, size)
    await page.screenshot({
      path: fileURLToPath(new URL(`../public/stylelens-icon-${size}.png`, import.meta.url)),
      type: 'png',
    })
    await page.close()
  }
} finally {
  await browser.close()
}

console.log('[StyleLens] rasterized icon PNGs: 16, 32, 48, 128')
