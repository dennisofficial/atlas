import { randomBytes, timingSafeEqual } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { chmod, lstat, mkdir, open, readlink, rename, unlink } from 'node:fs/promises'

import { z } from 'zod'

import { holderIsLive, isProcessAlive, startTimeOf } from '../../workspace/process-identity'

import type { ProcessStamp, SessionLockClaim } from './protocol'

export { isProcessAlive }

const MAX_JSON_BYTES = 1024 * 1024

const lockFileSchema = z.object({ pid: z.number().int(), start: z.string().optional() })

export type ReadOutcome<T> = { ok: true; value: T } | { ok: false; reason: string; missing: boolean }

export function newDurableIdentity(): string {
  return randomBytes(24).toString('hex')
}

export function newControlToken(): string {
  return randomBytes(32).toString('hex')
}

export function tokensMatch({ expected, presented }: { expected: string; presented: string }): boolean {
  const left = Buffer.from(expected)
  const right = Buffer.from(presented)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function stampOf({ pid }: { pid: number }): Promise<ProcessStamp> {
  const start = await startTimeOf({ pid })
  return start === undefined ? { pid } : { pid, start }
}

export async function stampIsLive({ stamp }: { stamp: ProcessStamp }): Promise<boolean> {
  return holderIsLive({ pid: stamp.pid, start: stamp.start })
}

export async function pidNamespaceOf(): Promise<string | undefined> {
  try {
    return await readlink('/proc/self/ns/pid')
  } catch {
    return undefined
  }
}

export async function lockClaimIsActive({ claim }: { claim: SessionLockClaim }): Promise<boolean> {
  if (claim.pidNamespace !== undefined && claim.pidNamespace !== (await pidNamespaceOf())) return false

  const lock = await readJsonFile({ path: claim.lockFile, schema: lockFileSchema })
  if (!lock.ok) return false
  return holderIsLive({ pid: lock.value.pid, start: lock.value.start })
}

function errorCodeOf({ error }: { error: unknown }): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error)
}

export async function ensurePrivateDirectory({ path }: { path: string }): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${path} is not a plain directory`)
  if (stats.uid !== process.getuid?.()) throw new Error(`${path} is owned by another user`)
  if ((stats.mode & 0o077) !== 0) await chmod(path, 0o700)
}

export async function writeFileAtomic({
  path,
  data,
  mode,
}: {
  path: string
  data: string
  mode: number
}): Promise<void> {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  const handle = await open(temporary, flags, mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export async function createExclusiveFile({
  path,
  data,
  mode,
}: {
  path: string
  data: string
  mode: number
}): Promise<void> {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  const handle = await open(path, flags, mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export function assertOwnRegularFile({ stats, path }: { stats: Stats; path: string }): void {
  if (!stats.isFile()) throw new Error(`${path} is not a regular file`)
  if (stats.uid !== process.getuid?.()) throw new Error(`${path} is owned by another user`)
}

export async function readTextFile({ path }: { path: string }): Promise<ReadOutcome<string>> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stats = await handle.stat()
      assertOwnRegularFile({ stats, path })
      if (stats.size > MAX_JSON_BYTES) return { ok: false, reason: `${path} is too large`, missing: false }
      return { ok: true, value: await handle.readFile('utf8') }
    } finally {
      await handle.close()
    }
  } catch (error) {
    return { ok: false, reason: messageOf({ error }), missing: errorCodeOf({ error }) === 'ENOENT' }
  }
}

export async function readJsonFile<T>({
  path,
  schema,
}: {
  path: string
  schema: z.ZodType<T>
}): Promise<ReadOutcome<T>> {
  const text = await readTextFile({ path })
  if (!text.ok) return text
  try {
    const parsed = schema.safeParse(JSON.parse(text.value))
    if (parsed.success) return { ok: true, value: parsed.data }
    return { ok: false, reason: `${path} does not match its schema`, missing: false }
  } catch {
    return { ok: false, reason: `${path} is not valid JSON`, missing: false }
  }
}
