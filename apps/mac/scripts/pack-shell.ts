import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { writeSupervisorBundle } from '../../../packages/harness/src/shells/supervisor-bundle'
import {
  bundlePaths,
  CEF_FRAMEWORK,
  CEF_HELPERS,
  HELPER_FRAMEWORK_LINK,
  helperInfoPlist,
  helperName,
  helperPath,
  SHELL_IDENTIFIER,
  SHELL_NAME,
  shellInfoPlist,
  signTargets,
} from './pack-shell-plan'

const appRoot = resolve(import.meta.dir, '..')
const swiftRelease = join(appRoot, 'swift', '.build', 'release', SHELL_NAME)
const cefRelease = join(appRoot, 'swift', '.cef', 'Release', CEF_FRAMEWORK)
const webStandalone = join(appRoot, 'web-standalone')
const buildRoot = join(appRoot, 'build')
const bundle = join(buildRoot, `${SHELL_NAME}.app`)
const paths = bundlePaths({ bundle, app: SHELL_NAME })
const version = process.env.ATLAS_VERSION ?? '0.1.0'

function fail(message: string): never {
  console.error(`pack-shell: ${message}`)
  process.exit(1)
}

function run({ cmd }: { cmd: string[] }): string {
  console.log(`$ ${cmd.join(' ')}`)
  const result = Bun.spawnSync({ cmd })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim()
  if (result.exitCode !== 0) fail(`${cmd[0]} exited with ${result.exitCode}\n${output}`)
  return output
}

function require(path: string, how: string): void {
  if (!existsSync(path)) fail(`missing ${path}; run ${how}`)
}

function shortSha(): string {
  return (process.env.GITHUB_SHA ?? run({ cmd: ['git', 'rev-parse', 'HEAD'] })).slice(0, 7)
}

async function bundleHost(): Promise<void> {
  await writeSupervisorBundle()
  await mkdir(join(paths.resources, 'app'), { recursive: true })
  const result = await Bun.build({
    entrypoints: [join(appRoot, 'src', 'desktop-host', 'index.ts')],
    target: 'bun',
    outdir: join(paths.resources, 'app'),
    naming: 'host.js',
  })
  if (!result.success) {
    for (const log of result.logs) console.error(String(log))
    fail('bundling the desktop host failed')
  }
}

async function bundleBun(): Promise<void> {
  const runtime = process.execPath
  if (!runtime.split('/').pop()?.startsWith('bun')) fail(`pack under bun, not ${runtime}`)
  const target = join(paths.contents, 'MacOS', 'bun')
  await cp(runtime, target)
  await chmod(target, 0o755)
}

async function assembly(): Promise<void> {
  require(swiftRelease, 'swift build -c release --package-path swift')
  require(join(webStandalone, 'apps', 'web', 'server.js'), 'bun run build:web')
  require(cefRelease, 'bun apps/mac/swift/scripts/fetch-cef.ts')

  await rm(bundle, { recursive: true, force: true })
  await mkdir(join(paths.contents, 'MacOS'), { recursive: true })
  await mkdir(paths.frameworks, { recursive: true })
  await mkdir(paths.resources, { recursive: true })

  await cp(swiftRelease, paths.executable)
  await chmod(paths.executable, 0o755)
  await writeFile(paths.infoPlist, shellInfoPlist({ identifier: SHELL_IDENTIFIER, version }))
  await cp(webStandalone, join(paths.resources, 'web-standalone'), { recursive: true })
  await bundleHost()
  await bundleBun()
  run({ cmd: ['ditto', cefRelease, paths.framework] })

  for (const helper of CEF_HELPERS) {
    const name = helperName({ app: SHELL_NAME, helper })
    const helperBundle = helperPath({ frameworks: paths.frameworks, app: SHELL_NAME, helper })
    await mkdir(join(helperBundle, 'Contents', 'MacOS'), { recursive: true })
    await mkdir(join(helperBundle, 'Contents', 'Frameworks'), { recursive: true })
    await cp(paths.executable, join(helperBundle, 'Contents', 'MacOS', name))
    await chmod(join(helperBundle, 'Contents', 'MacOS', name), 0o755)
    await writeFile(
      join(helperBundle, 'Contents', 'Info.plist'),
      helperInfoPlist({ app: SHELL_NAME, identifier: SHELL_IDENTIFIER, version, helper }),
    )
    await symlink(
      HELPER_FRAMEWORK_LINK,
      join(helperBundle, 'Contents', 'Frameworks', CEF_FRAMEWORK),
    )
  }
}

function sign(): void {
  for (const target of signTargets({ bundle, app: SHELL_NAME })) {
    const flags = target.deep ? ['--deep'] : []
    run({ cmd: ['codesign', '--force', '--sign', '-', ...flags, target.path] })
  }
}

async function archive(): Promise<number> {
  const zip = join(buildRoot, `${SHELL_NAME}-${shortSha()}-mac-arm64.zip`)
  await rm(zip, { force: true })
  run({ cmd: ['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip] })
  return (await stat(zip)).size
}

async function main(): Promise<void> {
  await assembly()
  sign()
  const verify = run({
    cmd: ['codesign', '--verify', '--deep', '--strict', '--verbose=2', bundle],
  })
  console.log(`codesign --verify --deep --strict: ok\n${verify}`.trim())
  const bytes = await archive()
  console.log(`bundle: ${bundle} (${run({ cmd: ['du', '-sh', bundle] }).split('\t')[0]})`)
  console.log(`size:   ${(bytes / 1024 / 1024).toFixed(1)} MiB zipped`)
}

if (import.meta.main) await main()
