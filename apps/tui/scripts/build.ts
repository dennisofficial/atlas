import { createRequire } from 'node:module'

import { probeSourceState, repoRootOf, sourceStampOf } from '../src/build/stamp'
import { stageVendoredRipgrep } from './stage-ripgrep'

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const define: Record<string, string> = {
  // The CLI's --compile dev-emits JSX (jsxDEV calls) while Bun.build's compile prod-emits, and
  // react's production jsx-dev-runtime exports jsxDEV as undefined — so a CLI build with this
  // define dies on first render. The API path is the only consistent-production one, and
  // production matters because dev react-reconciler floods the performance timeline per commit.
  'process.env.NODE_ENV': JSON.stringify('production'),
}

const version = process.env.ATLAS_VERSION
if (version !== undefined && version !== '') {
  define.ATLAS_VERSION = JSON.stringify(version)
  const releaseRepo = process.env.ATLAS_RELEASE_REPO
  if (releaseRepo !== undefined && releaseRepo !== '') {
    define.ATLAS_RELEASE_REPO = JSON.stringify(releaseRepo)
  }
  const buildSha = process.env.ATLAS_BUILD_SHA
  if (buildSha !== undefined && buildSha !== '') {
    define.ATLAS_BUILD_SHA = JSON.stringify(buildSha)
  }
} else {
  const repo = await repoRootOf(process.cwd())
  const state = repo === null ? null : await probeSourceState({ repo })
  if (repo !== null && state !== null) {
    define.ATLAS_BUILD_REPO = JSON.stringify(repo)
    define.ATLAS_BUILD_STAMP = JSON.stringify(sourceStampOf(state))
  } else {
    console.warn('not a git tree: building without a staleness stamp')
  }
}

const repoRoot = new URL('../../../', import.meta.url).pathname
const staged = await stageVendoredRipgrep({ repoRoot, target: arg('--target') })
define.ATLAS_VENDORED_RG_VERSION = JSON.stringify(staged.version)

const OPENTUI_PLATFORM_PACKAGES = [
  '@opentui/core-darwin-arm64',
  '@opentui/core-darwin-x64',
  '@opentui/core-linux-x64',
  '@opentui/core-linux-x64-musl',
  '@opentui/core-linux-arm64',
  '@opentui/core-linux-arm64-musl',
  '@opentui/core-win32-x64',
  '@opentui/core-win32-arm64',
]

const coreRequire = createRequire(require.resolve('@opentui/core/package.json'))
const external = OPENTUI_PLATFORM_PACKAGES.filter((name) => {
  try {
    coreRequire.resolve(name)
    return false
  } catch {
    return true
  }
})

const target = arg('--target')

const result = await Bun.build({
  entrypoints: ['src/main.tsx'],
  target: 'bun',
  external,
  define,
  sourcemap: 'linked',
  plugins: [
    {
      name: 'dev-jsx-runtime',
      setup(build) {
        build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
          path: `${process.cwd()}/node_modules/react/cjs/react-jsx-dev-runtime.development.js`,
        }))
      },
    },
  ],
  compile: {
    outfile: arg('--outfile') ?? 'bin/atlas',
    ...(target === undefined ? {} : { target: target as Bun.Build.CompileTarget }),
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
