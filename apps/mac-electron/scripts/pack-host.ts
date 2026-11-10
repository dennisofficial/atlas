import { chmodSync, cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { writeSupervisorBundle } from '../../../packages/harness/src/shells/supervisor-bundle'

const APP_ROOT = resolve(import.meta.dir, '..')
const REPO_ROOT = resolve(APP_ROOT, '..', '..')
const MAC_ROOT = join(REPO_ROOT, 'apps', 'mac')
const HOST_ENTRY = join(MAC_ROOT, 'src', 'desktop-host', 'index.ts')
export const WEB_STANDALONE = join(MAC_ROOT, 'web-standalone')
export const DIST = join(APP_ROOT, 'dist')
const STREAM_URL = 'wss://agent.byatlas.io/stream'

export function hostBuildArgs({ entry, outdir }) {
  return ['build', entry, '--target=bun', `--outdir=${outdir}`]
}

export function bunBinaryPathOf({ onPath, execPath }) {
  if (onPath !== null) return onPath
  if (basename(execPath).startsWith('bun')) return execPath
  throw new Error(`no bun executable to ship; the runtime is ${execPath}`)
}

export function standaloneIsBuilt({ root }) {
  return existsSync(join(root, 'apps', 'web', 'server.js'))
}

async function run({ args, cwd, env }) {
  const child = Bun.spawn({
    cmd: args,
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const code = await child.exited
  if (code !== 0) throw new Error(`\`${args.join(' ')}\` exited ${code}`)
}

export async function buildWebStandalone({ bun, root = REPO_ROOT, standalone = WEB_STANDALONE }) {
  await run({
    args: [bun, 'run', '--cwd', 'apps/web', 'build'],
    cwd: root,
    env: { ATLAS_STREAM_URL: STREAM_URL },
  })
  rmSync(standalone, { recursive: true, force: true })
  cpSync(join(root, 'apps', 'web', '.next', 'standalone'), standalone, {
    recursive: true,
    dereference: true,
  })
  await run({
    args: [bun, 'scripts/flatten-web-deps.ts', 'web-standalone'],
    cwd: join(root, 'apps', 'mac'),
  })
  await run({
    args: [bun, 'scripts/drop-native-web-deps.ts', 'web-standalone'],
    cwd: join(root, 'apps', 'mac'),
  })
  mkdirSync(join(standalone, 'apps', 'web', '.next'), { recursive: true })
  cpSync(
    join(root, 'apps', 'web', '.next', 'static'),
    join(standalone, 'apps', 'web', '.next', 'static'),
    {
      recursive: true,
      dereference: true,
    },
  )
  cpSync(join(root, 'apps', 'web', 'public'), join(standalone, 'apps', 'web', 'public'), {
    recursive: true,
    dereference: true,
  })
}

export async function packHost({ bun, out = DIST, standalone = WEB_STANDALONE, rebuild }) {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  await writeSupervisorBundle()

  await run({ args: [bun, ...hostBuildArgs({ entry: HOST_ENTRY, outdir: out })], cwd: REPO_ROOT })
  const host = join(out, 'host.js')
  renameSync(join(out, 'index.js'), host)

  if (rebuild || !standaloneIsBuilt({ root: standalone })) {
    await buildWebStandalone({ bun, standalone })
  }
  cpSync(standalone, join(out, 'web-standalone'), { recursive: true, dereference: true })

  mkdirSync(join(out, 'bin'), { recursive: true })
  const runtime = join(out, 'bin', 'bun')
  cpSync(bun, runtime)
  chmodSync(runtime, 0o755)

  return { host, size: statSync(host).size, standalone: join(out, 'web-standalone'), runtime }
}

if (import.meta.main) {
  const bun = bunBinaryPathOf({ onPath: Bun.which('bun'), execPath: process.execPath })
  const result = await packHost({ bun, rebuild: process.env.ATLAS_REBUILD_WEB === '1' })
  console.log(`host.js ${result.size} bytes at ${result.host}`)
  console.log(`web standalone at ${result.standalone}`)
  console.log(`bun runtime at ${result.runtime}`)
}
