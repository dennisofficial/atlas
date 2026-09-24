import { probeSourceState, repoRootOf, sourceStampOf } from '../src/build/stamp'
import { stageVendoredRipgrep } from './stage-ripgrep'

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const defineOf = (name: string, value: string): string => `${name}:${JSON.stringify(value)}`

const defines: string[] = []

// Bun resolves an unset NODE_ENV to "development" at bundle time, which ships react-reconciler's
// development build: it calls performance.measure per component commit, flooding the performance
// timeline (~200 MB per tile in minutes) and churning the heap at frame cadence.
defines.push(defineOf('process.env.NODE_ENV', 'production'))

const version = process.env.ATLAS_VERSION
if (version !== undefined && version !== '') {
  defines.push(defineOf('ATLAS_VERSION', version))
  const releaseRepo = process.env.ATLAS_RELEASE_REPO
  if (releaseRepo !== undefined && releaseRepo !== '') {
    defines.push(defineOf('ATLAS_RELEASE_REPO', releaseRepo))
  }
  const buildSha = process.env.ATLAS_BUILD_SHA
  if (buildSha !== undefined && buildSha !== '') {
    defines.push(defineOf('ATLAS_BUILD_SHA', buildSha))
  }
} else {
  const repo = await repoRootOf(process.cwd())
  const state = repo === null ? null : await probeSourceState({ repo })
  if (repo !== null && state !== null) {
    defines.push(defineOf('ATLAS_BUILD_REPO', repo))
    defines.push(defineOf('ATLAS_BUILD_STAMP', sourceStampOf(state)))
  } else {
    console.warn('not a git tree: building without a staleness stamp')
  }
}

const repoRoot = new URL('../../../', import.meta.url).pathname
const staged = await stageVendoredRipgrep({ repoRoot, target: arg('--target') })
defines.push(defineOf('ATLAS_VENDORED_RG_VERSION', staged.version))

const cmd = [
  'bun',
  'build',
  '--compile',
  '--sourcemap',
  ...defines.flatMap((define) => ['--define', define]),
  ...(arg('--target') === undefined ? [] : ['--target', arg('--target') as string]),
  'src/main.tsx',
  '--outfile',
  arg('--outfile') ?? 'bin/atlas',
]

const build = Bun.spawnSync({ cmd, stdout: 'inherit', stderr: 'inherit' })
process.exit(build.exitCode)
