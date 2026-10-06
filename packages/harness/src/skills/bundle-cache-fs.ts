import { constants, type BigIntStats } from 'node:fs'
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { digestOfBytes } from './embedded-bundle'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const READ_CONCURRENCY = 16

type Snapshot = { size: bigint; mtimeNs: bigint; ino: bigint }

const verifiedSnapshots = new Map<string, Snapshot>()

const snapshotOf = (info: BigIntStats): Snapshot => ({
  size: info.size,
  mtimeNs: info.mtimeNs,
  ino: info.ino,
})

const unchanged = (args: { previous: Snapshot; current: Snapshot }): boolean =>
  args.previous.size === args.current.size &&
  args.previous.mtimeNs === args.current.mtimeNs &&
  args.previous.ino === args.current.ino

const keyOf = (args: { path: string; digest: string }): string => `${args.path}\0${args.digest}`

export const lstatOrNull = async (path: string): Promise<BigIntStats | null> =>
  await lstat(path, { bigint: true }).catch(() => null)

const digestOfFile = async (path: string): Promise<string | null> => {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null)
  if (handle === null) return null
  try {
    return digestOfBytes(await handle.readFile())
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

export async function holdsFile(args: { path: string; digest: string }): Promise<boolean> {
  const info = await lstatOrNull(args.path)
  if (info === null || !info.isFile()) return false

  const key = keyOf(args)
  const known = verifiedSnapshots.get(key)
  const current = snapshotOf(info)
  if (known !== undefined && unchanged({ previous: known, current })) return true

  if ((await digestOfFile(args.path)) !== args.digest) {
    verifiedSnapshots.delete(key)
    return false
  }

  verifiedSnapshots.set(key, current)
  return true
}

export async function ensureRealDirectory(path: string): Promise<void> {
  const info = await lstatOrNull(path)
  if (info?.isDirectory() === true) return
  if (info !== null) await rm(path, { force: true })

  try {
    await mkdir(path, { mode: DIRECTORY_MODE })
  } catch (error) {
    if ((await lstatOrNull(path))?.isDirectory() !== true) throw error
  }
}

export async function ensureRealDirectories(args: { root: string; segments: readonly string[] }): Promise<string> {
  let current = args.root
  for (const segment of args.segments) {
    current = join(current, segment)
    await ensureRealDirectory(current)
  }
  return current
}

export async function writeFileExclusive(args: { path: string; bytes: Uint8Array }): Promise<void> {
  const handle = await open(
    args.path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    FILE_MODE,
  )
  try {
    await handle.writeFile(args.bytes)
  } finally {
    await handle.close()
  }
}

export async function replaceFile(args: { path: string; bytes: Uint8Array; digest: string }): Promise<void> {
  const staging = `${args.path}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    await writeFileExclusive({ path: staging, bytes: args.bytes })
    const existing = await lstatOrNull(args.path)
    if (existing?.isDirectory() === true) await rm(args.path, { recursive: true, force: true })
    await rename(staging, args.path)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }

  const info = await lstatOrNull(args.path)
  if (info !== null) verifiedSnapshots.set(keyOf(args), snapshotOf(info))
}

export async function mapLimited<T, R>(args: {
  items: readonly T[]
  run: (item: T) => Promise<R>
}): Promise<readonly R[]> {
  const results: R[] = []
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < args.items.length) {
      const at = next
      next += 1
      const item = args.items[at]
      if (item === undefined) continue
      results[at] = await args.run(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, args.items.length) }, worker))
  return results
}
