import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DevServeBinary } from '@dltech/atlas-wire'

import { devServePinOf, type ELinuxServeTarget } from './dev-serve-key'

const BINARY_NAME_PREFIX = 'atlas-serve-'
const TARGET_PREFIX = 'bun-'
const META_NAME = 'meta.json'
const STAGING_PREFIX = '.staging-'
const STALE_STAGING_MS = 60 * 60 * 1000

type DevServeMeta = { version: string; sha256: string; bytes: number; inputKey: string }

const isMeta = (value: unknown): value is DevServeMeta => {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...value }
  return (
    typeof record.version === 'string' &&
    typeof record.sha256 === 'string' &&
    typeof record.bytes === 'number' &&
    typeof record.inputKey === 'string'
  )
}

export const devServeBinaryNameOf = (target: ELinuxServeTarget): string =>
  `${BINARY_NAME_PREFIX}${target.slice(TARGET_PREFIX.length)}`

const binaryPathOf = (args: { root: string; inputKey: string; target: ELinuxServeTarget }): string =>
  join(args.root, args.inputKey, devServeBinaryNameOf(args.target))

const metaPathOf = (args: { root: string; inputKey: string }): string =>
  join(args.root, args.inputKey, META_NAME)

const sizeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

const readMeta = async (path: string): Promise<DevServeMeta | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isMeta(parsed) ? parsed : null
  } catch {
    return null
  }
}

const markUsed = async (args: { path: string; now: number }): Promise<void> => {
  const at = new Date(args.now)
  await utimes(args.path, at, at).catch(() => undefined)
}

export async function readCachedDevServe(args: {
  root: string
  inputKey: string
  target: ELinuxServeTarget
  now: number
}): Promise<DevServeBinary | null> {
  const meta = await readMeta(metaPathOf(args))
  if (meta === null || meta.inputKey !== args.inputKey) return null

  const path = binaryPathOf(args)
  if ((await sizeOf(path)) !== meta.bytes) return null

  await markUsed({ path: metaPathOf(args), now: args.now })
  return { version: meta.version, path, sha256: meta.sha256, bytes: meta.bytes }
}

export async function createDevServeStaging(args: { root: string }): Promise<string> {
  await mkdir(args.root, { recursive: true })
  return mkdtemp(join(args.root, STAGING_PREFIX))
}

const sha256Of = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher('sha256')
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest('hex')
}

export async function storeDevServe(args: {
  root: string
  inputKey: string
  target: ELinuxServeTarget
  built: string
  now: number
}): Promise<DevServeBinary> {
  const bytes = await sizeOf(args.built)
  if (bytes === null) throw new Error(`the dev serve build produced no binary at ${args.built}`)
  const sha256 = await sha256Of(args.built)
  const version = devServePinOf(sha256)

  await mkdir(join(args.root, args.inputKey), { recursive: true })
  const path = binaryPathOf(args)
  await rename(args.built, path)

  const meta: DevServeMeta = { version, sha256, bytes, inputKey: args.inputKey }
  const metaPath = metaPathOf(args)
  const metaStaging = `${metaPath}.${process.pid}.tmp`
  await writeFile(metaStaging, JSON.stringify(meta))
  await rename(metaStaging, metaPath)
  await markUsed({ path: metaPath, now: args.now })
  return { version, path, sha256, bytes }
}

const modifiedAt = async (path: string): Promise<number> => {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

export async function pruneDevServeCache(args: {
  root: string
  keep: number
  current: string
  now: number
}): Promise<readonly string[]> {
  const entries = await readdir(args.root, { withFileTypes: true }).catch(() => [])
  const directories = entries.filter((entry) => entry.isDirectory())

  const cached = await Promise.all(
    directories
      .filter((entry) => !entry.name.startsWith(STAGING_PREFIX))
      .map(async (entry) => ({
        name: entry.name,
        usedAt: await modifiedAt(join(args.root, entry.name, META_NAME)),
      })),
  )
  const newestFirst = cached.sort((a, b) => b.usedAt - a.usedAt).map((entry) => entry.name)
  const kept = new Set([args.current, ...newestFirst.filter((name) => name !== args.current).slice(0, args.keep - 1)])
  const evicted = newestFirst.filter((name) => !kept.has(name))

  const staleStaging: string[] = []
  for (const entry of directories) {
    if (!entry.name.startsWith(STAGING_PREFIX)) continue
    const age = args.now - (await modifiedAt(join(args.root, entry.name)))
    if (age > STALE_STAGING_MS) staleStaging.push(entry.name)
  }

  for (const name of [...evicted, ...staleStaging]) {
    await rm(join(args.root, name), { recursive: true, force: true })
  }
  return evicted
}
