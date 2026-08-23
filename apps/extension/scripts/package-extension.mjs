/**
 * Package the built extension into services/api/public/stylelens.zip
 * (served by the landing page as the install/download artifact).
 *
 * zip 内容平铺在根目录（manifest.json / content.js / ...），
 * 用户解压后直接选择解压出的文件夹即可 Load unpacked，避免嵌套目录选错。
 */
import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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

function addDir(dir, base) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(base, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      addDir(full, base)
    } else {
      zip.addFile(rel, readFileSync(full))
    }
  }
}

addDir(dist, dist)
zip.writeZip(outFile)

// 校验：manifest.json 必须位于 zip 根
const hasRootManifest = zip.getEntries().some((e) => e.entryName === 'manifest.json')
if (!hasRootManifest) {
  console.error('[StyleLens] zip packaging failed: manifest.json not at zip root')
  process.exit(1)
}

console.log(`[StyleLens] packaged (flat) → ${outFile}`)
