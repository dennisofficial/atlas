import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { atlasDirectory } from '@dltech/atlas-harness'
import type { DevServeBinary, DevServeResolver } from '@dltech/atlas-wire'

import { EBuildKind, type BuildInfo } from '../../build/info'
import { repoRootOf } from '../../build/stamp'
import {
  createDevServeStaging,
  devServeBinaryNameOf,
  pruneDevServeCache,
  readCachedDevServe,
  storeDevServe,
} from './dev-serve-cache'
import {
  devServeCacheKeyOf,
  ELinuxServeTarget,
  probeDevServeSource,
  type DevServeSourceProbe,
} from './dev-serve-key'

export type DevServeBuild = (args: {
  repo: string
  outfile: string
  target: ELinuxServeTarget
}) => Promise<void>

export type DevServeDeps = {
  repo: () => Promise<string | null>
  probe: DevServeSourceProbe
  build: DevServeBuild
  target: ELinuxServeTarget
  cacheRoot: () => string
  now: () => number
  keep: number
}

const DEFAULT_KEEP = 3
const FAILURE_TAIL_CHARS = 4_000

const tailOf = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.length <= FAILURE_TAIL_CHARS ? trimmed : `…${trimmed.slice(-FAILURE_TAIL_CHARS)}`
}

const bunExecutable = (): string =>
  basename(process.execPath).startsWith('bun') ? process.execPath : 'bun'

export const devServeBuildArgvOf = (args: {
  target: ELinuxServeTarget
  outfile: string
}): string[] => [
  bunExecutable(),
  'scripts/build-serve.ts',
  '--target',
  args.target,
  '--outfile',
  args.outfile,
]

export const buildDevServeWithBun: DevServeBuild = async ({ repo, outfile, target }) => {
  const proc = Bun.spawn(devServeBuildArgvOf({ target, outfile }), {
    cwd: join(repo, 'apps', 'serve'),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code === 0) return
  const output = tailOf(stderr.length > 0 ? stderr : stdout)
  throw new Error(
    `the dev serve build failed (exit ${code}): ${output.length > 0 ? output : 'no output'}`,
  )
}

const secondsSince = (args: { start: number; now: number }): string =>
  ((args.now - args.start) / 1000).toFixed(1)

const inputsLabel = (inputKey: string): string => inputKey.slice(0, 8)

let processWideBuildQueue: Promise<unknown> = Promise.resolve()

export function createDevServeResolver(deps: DevServeDeps): DevServeResolver {
  const inFlight = new Map<string, Promise<DevServeBinary>>()

  const sourceKey = async (repo: string): Promise<string> => {
    const source = await deps.probe({ repo })
    if (source === null)
      throw new Error(`cannot pin a dev serve: ${repo} is not a readable git checkout`)
    return devServeCacheKeyOf({ source, target: deps.target })
  }

  const cachedFor = async (args: {
    inputKey: string
    log: (line: string) => void
  }): Promise<DevServeBinary | null> => {
    const cached = await readCachedDevServe({
      root: deps.cacheRoot(),
      inputKey: args.inputKey,
      target: deps.target,
      now: deps.now(),
    })
    if (cached !== null)
      args.log(`dev serve ${cached.version} cached (inputs ${inputsLabel(args.inputKey)})`)
    return cached
  }

  const buildAndStore = async (args: {
    repo: string
    inputKey: string
    log: (line: string) => void
  }): Promise<DevServeBinary> => {
    const cached = await cachedFor(args)
    if (cached !== null) return cached

    const root = deps.cacheRoot()
    args.log(`building dev serve (inputs ${inputsLabel(args.inputKey)}) from ${args.repo}…`)
    const start = deps.now()
    const staging = await createDevServeStaging({ root })
    try {
      const outfile = join(staging, devServeBinaryNameOf(deps.target))
      await deps.build({ repo: args.repo, outfile, target: deps.target })
      const builtKey = await sourceKey(args.repo)
      if (builtKey !== args.inputKey) {
        args.log(
          `the dev serve build changed the tree: caching it under inputs ${inputsLabel(builtKey)}, not ${inputsLabel(args.inputKey)}`,
        )
      }
      const stored = await storeDevServe({
        root,
        inputKey: builtKey,
        target: deps.target,
        built: outfile,
        now: deps.now(),
      })
      args.log(
        `built dev serve ${stored.version} (inputs ${inputsLabel(builtKey)}) in ${secondsSince({ start, now: deps.now() })}s`,
      )
      await pruneDevServeCache({ root, keep: deps.keep, current: builtKey, now: deps.now() }).catch(
        () => undefined,
      )
      return stored
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  return async ({ log }) => {
    const narrate = log ?? (() => undefined)
    const repo = await deps.repo()
    if (repo === null)
      throw new Error('cannot pin a dev serve: this Atlas build has no source checkout')

    const inputKey = await sourceKey(repo)
    const shared = inFlight.get(inputKey)
    if (shared !== undefined) return shared

    const cached = await cachedFor({ inputKey, log: narrate })
    if (cached !== null) return cached
    const sharedAfterRead = inFlight.get(inputKey)
    if (sharedAfterRead !== undefined) return sharedAfterRead

    const resolving = processWideBuildQueue.then(() =>
      buildAndStore({ repo, inputKey, log: narrate }),
    )
    processWideBuildQueue = resolving.catch(() => undefined)
    inFlight.set(inputKey, resolving)
    try {
      return await resolving
    } finally {
      inFlight.delete(inputKey)
    }
  }
}

const repoOfBuild = (build: BuildInfo): (() => Promise<string | null>) | undefined => {
  if (build.kind === EBuildKind.Release) return undefined
  if (build.kind === EBuildKind.Dev) return async () => build.repo
  return () => repoRootOf(import.meta.dirname)
}

const sharedResolvers = new Map<string, DevServeResolver>()

export function devServeResolverFor(
  build: BuildInfo,
  options: { target: ELinuxServeTarget } = { target: ELinuxServeTarget.X64 },
): DevServeResolver | undefined {
  const repo = repoOfBuild(build)
  if (repo === undefined) return undefined

  const buildKey = build.kind === EBuildKind.Dev ? `${build.kind}:${build.repo}` : build.kind
  const key = `${buildKey}:${options.target}`
  const held = sharedResolvers.get(key)
  if (held !== undefined) return held

  const resolver = createDevServeResolver({
    repo,
    probe: probeDevServeSource,
    build: buildDevServeWithBun,
    target: options.target,
    cacheRoot: () => join(atlasDirectory(), 'dev-serve'),
    now: () => Date.now(),
    keep: DEFAULT_KEEP,
  })
  sharedResolvers.set(key, resolver)
  return resolver
}
