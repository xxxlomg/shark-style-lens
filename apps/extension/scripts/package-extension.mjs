/** Package the built extension into a flat ZIP for Chrome developer mode. */
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { finished } from 'node:stream/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yazl from 'yazl'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const outDir = resolve(root, '../../services/api/public')
const zipFile = join(outDir, 'stylelens.zip')

if (!existsSync(dist)) {
  console.error('[StyleLens] dist not found — run `pnpm build` first')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

const zip = new yazl.ZipFile()

function addDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      addDirectory(filePath)
    } else {
      zip.addFile(filePath, relative(dist, filePath).replace(/\\/g, '/'))
    }
  }
}

addDirectory(dist)
const output = createWriteStream(zipFile)
zip.outputStream.pipe(output)
zip.end()
await finished(output)

if (!existsSync(zipFile)) {
  console.error('[StyleLens] packaging failed: ZIP artifact is missing')
  process.exit(1)
}

console.log(`[StyleLens] packaged developer-mode ZIP → ${zipFile}`)
