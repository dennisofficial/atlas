/// <reference types="bun" />
import { existsSync, readdirSync } from 'node:fs'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { lockedRuntimePackages } from './build-runtime-packages'

const TIER_FILE = '.env.api.production.enc'

// Lazy imports of NestJS and its libraries (the NestJS bundling guide's list) that this API never installs.
const OPTIONAL_IMPORTS = [
  '@nestjs/graphql',
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module',
  '@nestjs/websockets/socket-module',
  '@nestjs/websockets/socket-module.js',
]

// @thallesp/nestjs-better-auth loads express with createRequire(), which a bundler cannot follow.
const RUNTIME_PACKAGES = ['express']

type FunctionManifest = {
  type: 'module'
  dependencies: Record<string, string>
}

type FunctionConfig = {
  runtime: 'bun1.x'
  handler: string
  launcherType: 'Nodejs'
  supportsResponseStreaming: true
  // The Build Output API field is `environment`; `env` is silently ignored by Vercel.
  environment: Record<string, string>
}

type OutputConfig = {
  version: 3
  routes: ({ handle: 'filesystem' } | { src: string; dest: string })[]
}

async function writeJson({
  path,
  value,
}: {
  path: string
  value: FunctionManifest | FunctionConfig | OutputConfig
}): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function shippedMigrationNames(): string[] {
  return readdirSync(join(import.meta.dir, 'prisma', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

export async function buildVercelOutput({ outDir }: { outDir: string }): Promise<void> {
  const functionDir = join(outDir, 'functions', 'index.func')

  await rm(outDir, { recursive: true, force: true })
  await mkdir(functionDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, 'src', 'vercel.ts')],
    outdir: functionDir,
    naming: 'index.js',
    target: 'bun',
    format: 'esm',
    sourcemap: 'linked',
    external: [...OPTIONAL_IMPORTS, ...RUNTIME_PACKAGES],
    define: { __ATLAS_SHIPPED_MIGRATIONS__: JSON.stringify(shippedMigrationNames()) },
  })

  if (!result.success) {
    throw new AggregateError(result.logs, 'Bundling the API failed')
  }

  const runtime = await lockedRuntimePackages({
    lockPath: join(import.meta.dir, '..', '..', 'bun.lock'),
    roots: RUNTIME_PACKAGES,
  })
  await writeJson({ path: join(functionDir, 'package.json'), value: { type: 'module', dependencies: runtime.dependencies } })
  await writeFile(join(functionDir, 'bun.lock'), `${JSON.stringify(runtime.lock, null, 2)}\n`)

  // --os=* --cpu=* keeps every platform's optional binaries: the build host differs from Vercel's linux x64.
  const install = Bun.spawnSync(
    ['bun', 'install', '--production', '--linker', 'hoisted', '--frozen-lockfile', '--os=*', '--cpu=*'],
    { cwd: functionDir, stdout: 'inherit', stderr: 'inherit' },
  )
  if (install.exitCode !== 0) {
    throw new Error('Installing the runtime packages of the function failed')
  }

  const tierSource = join(import.meta.dir, 'envs', TIER_FILE)
  if (!existsSync(tierSource)) {
    throw new Error(`${TIER_FILE} not found at ${tierSource}; the committed tier must exist to ship in the bundle.`)
  }
  await cp(tierSource, join(functionDir, TIER_FILE))

  await writeJson({
    path: join(functionDir, '.vc-config.json'),
    value: {
      runtime: 'bun1.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      supportsResponseStreaming: true,
      environment: { DOTENVX_ENVS_DIR: '.', APP_TIER: 'production' },
    },
  })
  await writeJson({
    path: join(outDir, 'config.json'),
    value: { version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/' }] },
  })
}

if (import.meta.main) {
  await buildVercelOutput({ outDir: join(import.meta.dir, '.vercel', 'output') })
}
