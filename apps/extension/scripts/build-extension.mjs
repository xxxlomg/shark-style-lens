/**
 * Build the MV3 extension into apps/extension/dist:
 *   1. app build  → background.js + popup/ (ES modules)
 *   2. content build → content.js (IIFE)
 *   3. copy manifest.json + public assets
 */
import { build } from 'vite'
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

await build({ configFile: resolve(root, 'vite.app.config.ts') })
await build({ configFile: resolve(root, 'vite.content.config.ts') })

copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
if (existsSync(resolve(root, 'public'))) {
  cpSync(resolve(root, 'public'), dist, { recursive: true })
}

console.log(`[StyleLens] extension built → ${dist}`)
