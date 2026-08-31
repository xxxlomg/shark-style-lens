import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicSource = resolve(desktopRoot, '../../services/api/public')
const resourceRoot = resolve(desktopRoot, 'src-tauri/resources/stylelens-public')
const iconSource = resolve(desktopRoot, '../../apps/extension/public/stylelens-icon-128.png')
const iconTarget = resolve(desktopRoot, 'src-tauri/icons/icon.png')
const iconIcoTarget = resolve(desktopRoot, 'src-tauri/icons/icon.ico')

if (!existsSync(publicSource)) throw new Error(`API public directory is missing: ${publicSource}`)
if (!existsSync(resolve(publicSource, 'stylelens.zip'))) {
  throw new Error('stylelens.zip is missing; build the extension before staging desktop resources')
}

rmSync(resourceRoot, { recursive: true, force: true })
mkdirSync(dirname(resourceRoot), { recursive: true })
cpSync(publicSource, resourceRoot, { recursive: true })
mkdirSync(dirname(iconTarget), { recursive: true })
cpSync(iconSource, iconTarget)

// Tauri's Windows resource compiler requires an ICO. PNG payloads are valid
// ICO image entries and preserve the antialiased source icon without a second
// rasterization tool in the build environment.
const iconPng = readFileSync(iconSource)
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
const icoEntry = Buffer.alloc(16)
icoEntry.writeUInt8(0, 0)
icoEntry.writeUInt8(0, 1)
icoEntry.writeUInt8(0, 2)
icoEntry.writeUInt8(0, 3)
icoEntry.writeUInt16LE(1, 4)
icoEntry.writeUInt16LE(32, 6)
icoEntry.writeUInt32LE(iconPng.length, 8)
icoEntry.writeUInt32LE(22, 12)
writeFileSync(iconIcoTarget, Buffer.concat([icoHeader, icoEntry, iconPng]))
console.log(`[StyleLens] desktop resources staged -> ${resourceRoot}`)
