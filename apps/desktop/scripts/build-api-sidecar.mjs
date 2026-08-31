import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiRoot = resolve(desktopRoot, '../../services/api')
const tauriRoot = resolve(desktopRoot, 'src-tauri')
const binaryDir = resolve(tauriRoot, 'binaries')
const bundleDir = resolve(desktopRoot, '.build')
const bundleFile = join(bundleDir, 'stylelens-api.cjs')

function targetTriple() {
  if (process.env.TARGET_TRIPLE) return process.env.TARGET_TRIPLE
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'aarch64-pc-windows-msvc'
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'darwin') return 'x86_64-apple-darwin'
  return `${process.arch}-unknown-linux-gnu`
}

function pkgTarget(triple) {
  if (triple.includes('windows')) return triple.startsWith('aarch64') ? 'node22-win-arm64' : 'node22-win-x64'
  if (triple.includes('darwin')) return triple.startsWith('aarch64') ? 'node22-macos-arm64' : 'node22-macos-x64'
  return triple.startsWith('aarch64') ? 'node22-linux-arm64' : 'node22-linux-x64'
}

const triple = targetTriple()
const output = join(binaryDir, `stylelens-api-${triple}${triple.includes('windows') ? '.exe' : ''}`)

rmSync(bundleDir, { recursive: true, force: true })
mkdirSync(bundleDir, { recursive: true })
mkdirSync(binaryDir, { recursive: true })

await build({
  absWorkingDir: apiRoot,
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: bundleFile,
  sourcemap: false,
  minify: true,
  external: ['node:*'],
  logLevel: 'info',
})

const pkgEntry = resolve(desktopRoot, 'node_modules/@yao-pkg/pkg/lib-es5/bin.js')
execFileSync(process.execPath, [pkgEntry, bundleFile, '--targets', pkgTarget(triple), '--output', output], {
  cwd: desktopRoot,
  stdio: 'inherit',
})

if (!existsSync(output)) {
  throw new Error(`API sidecar was not produced: ${output}`)
}
console.log(`[StyleLens] API sidecar built -> ${output}`)
