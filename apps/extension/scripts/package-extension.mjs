/**
 * Package the built extension into services/api/public/stylelens.zip
 * (served by the landing page as the install/download artifact).
 * Run after `pnpm build`. A .crx is not produced (requires signing).
 */
import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const outDir = resolve(root, '../../services/api/public')
const outFile = join(outDir, 'stylelens.zip')

if (!existsSync(dist)) {
  console.error('[StyleLens] dist not found — run `pnpm build` first')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
rmSync(outFile, { force: true })

const zip = new AdmZip()
zip.addLocalFolder(dist, 'stylelens')
zip.writeZip(outFile)

console.log(`[StyleLens] packaged → ${outFile}`)
