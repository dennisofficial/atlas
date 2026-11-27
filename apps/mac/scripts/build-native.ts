import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const appRoot = join(import.meta.dir, '..')
const native = join(appRoot, 'native')
const swiftSources = join(native, 'src')
const swiftLibrary = join(native, 'build', 'swift', 'libAtlasNativeUI.a')
const product = join(native, 'prebuilds', 'darwin-arm64', 'atlas_native.node')

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.log(`native: nothing to build on ${process.platform}-${process.arch}`)
  process.exit(0)
}

const run = ({ cmd, cwd }: { cmd: string[]; cwd: string }) => {
  const result = Bun.spawnSync({ cmd, cwd, stdout: 'inherit', stderr: 'inherit' })
  if (result.exitCode === 0) return
  console.error(`native: \`${cmd.join(' ')}\` exited ${result.exitCode}`)
  process.exit(1)
}

const manifest = await Bun.file(join(appRoot, 'package.json')).json()
const electron = manifest.devDependencies?.electron
if (typeof electron !== 'string') {
  console.error('native: apps/mac has no electron devDependency to build against')
  process.exit(1)
}

mkdirSync(join(native, 'build', 'swift'), { recursive: true })
mkdirSync(join(native, 'prebuilds', 'darwin-arm64'), { recursive: true })

const sources = readdirSync(swiftSources)
  .filter((name) => name.endsWith('.swift'))
  .map((name) => join(swiftSources, name))
  .sort()

run({
  cwd: appRoot,
  cmd: [
    'xcrun',
    'swiftc',
    '-parse-as-library',
    '-emit-library',
    '-static',
    '-module-name',
    'AtlasNativeUI',
    '-target',
    'arm64-apple-macos14.0',
    '-O',
    '-import-objc-header',
    join(native, 'include', 'AtlasNative.h'),
    '-o',
    swiftLibrary,
    ...sources,
  ],
})

run({
  cwd: appRoot,
  cmd: [
    join(appRoot, 'node_modules', '.bin', 'node-gyp'),
    'rebuild',
    '--directory',
    native,
    '--target',
    electron,
    '--arch',
    'arm64',
    '--dist-url=https://electronjs.org/headers',
  ],
})

rmSync(product, { force: true })
copyFileSync(join(native, 'build', 'Release', 'atlas_native.node'), product)
console.log(`native: built ${product} against electron ${electron}`)
