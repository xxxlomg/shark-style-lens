/**
 * Build the MV3 extension into apps/extension/dist:
 *   1. app build  → background.js + popup/ (ES modules)
 *   2. content build → content.js (IIFE)
 *   3. copy manifest.json + public assets
 */
import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const publicDir = resolve(root, 'public')
const installAssetsDir = resolve(root, '../../services/api/public/assets')

// Keep generated PNGs and the install-page assets in sync with the SVG source.
execFileSync(process.execPath, [resolve(root, 'scripts/rasterize-icons.mjs')], {
  stdio: 'inherit',
})

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

await build({ configFile: resolve(root, 'vite.app.config.ts') })
await build({ configFile: resolve(root, 'vite.content.config.ts') })

copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
if (existsSync(publicDir)) {
  cpSync(publicDir, dist, { recursive: true })
}

if (existsSync(installAssetsDir)) {
  copyFileSync(
    resolve(publicDir, 'stylelens-icon.svg'),
    resolve(installAssetsDir, 'stylelens-icon.svg'),
  )
  copyFileSync(
    resolve(publicDir, 'stylelens-icon-128.png'),
    resolve(installAssetsDir, 'stylelens-icon-128.png'),
  )
}

console.log(`[StyleLens] extension built → ${dist}`)
