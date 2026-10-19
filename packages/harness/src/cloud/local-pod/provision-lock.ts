import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type ProvisionLock = <T>(args: { name: string; run: () => Promise<T> }) => Promise<T>

type LockOptions = {
  directory?: string | undefined
  staleCheck?: ((pid: number) => boolean) | undefined
  pollMs?: number | undefined
  deadlineMs?: number | undefined
}

type Holder = { pid: number | undefined; raw: string }

const DEFAULT_POLL_MS = 100
const DEFAULT_DEADLINE_MS = 10 * 60 * 1000
const UNREADABLE_LOCK_GRACE_MS = 30_000

const errorCodeOf = (failure: unknown): string | undefined =>
  typeof failure === 'object' && failure !== null && 'code' in failure && typeof failure.code === 'string'
    ? failure.code
    : undefined

const defaultStaleCheck = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return false
  } catch (failure) {
    return errorCodeOf(failure) === 'ESRCH'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const readHolder = async (path: string): Promise<Holder | undefined> => {
  const raw = await readFile(path, 'utf8').catch((failure: unknown) => {
    if (errorCodeOf(failure) === 'ENOENT') return undefined
    return ''
  })
  if (raw === undefined) return undefined
  const pid = Number.parseInt(raw.trim(), 10)
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : undefined, raw }
}

const ageOfMs = async (path: string): Promise<number> => {
  const info = await stat(path).catch(() => undefined)
  return info === undefined ? 0 : Date.now() - info.mtimeMs
}

const removeIfStill = async (args: { path: string; raw: string }): Promise<void> => {
  const current = await readHolder(args.path)
  if (current === undefined || current.raw !== args.raw) return
  await unlink(args.path).catch((failure: unknown) => {
    if (errorCodeOf(failure) !== 'ENOENT') throw failure
  })
}

const tryCreate = async (args: { path: string }): Promise<boolean> => {
  const handle = await open(args.path, 'wx').catch((failure: unknown) => {
    if (errorCodeOf(failure) === 'EEXIST') return undefined
    throw failure
  })
  if (handle === undefined) return false
  try {
    await handle.writeFile(String(process.pid))
  } finally {
    await handle.close()
  }
  return true
}

const isTakeable = async (args: {
  path: string
  holder: Holder
  staleCheck: (pid: number) => boolean
}): Promise<boolean> => {
  if (args.holder.pid !== undefined) return args.staleCheck(args.holder.pid)
  return (await ageOfMs(args.path)) > UNREADABLE_LOCK_GRACE_MS
}

export function fileProvisionLock(args: LockOptions = {}): ProvisionLock {
  const directory = args.directory ?? join(tmpdir(), 'atlas-pod-locks')
  const staleCheck = args.staleCheck ?? defaultStaleCheck
  const pollMs = args.pollMs ?? DEFAULT_POLL_MS
  const deadlineMs = args.deadlineMs ?? DEFAULT_DEADLINE_MS

  const acquire = async (lock: { name: string; path: string }): Promise<void> => {
    const startedAt = Date.now()
    for (;;) {
      if (await tryCreate({ path: lock.path })) return
      const holder = await readHolder(lock.path)
      if (holder === undefined) continue
      if (await isTakeable({ path: lock.path, holder, staleCheck })) {
        await removeIfStill({ path: lock.path, raw: holder.raw })
        continue
      }
      if (Date.now() - startedAt >= deadlineMs) {
        throw new Error(
          `pod ${lock.name} is being provisioned by process ${holder.pid ?? 'unknown'}; gave up waiting after ${deadlineMs}ms`,
        )
      }
      await sleep(pollMs)
    }
  }

  return async <T>(call: { name: string; run: () => Promise<T> }): Promise<T> => {
    await mkdir(directory, { recursive: true })
    const lock = { name: call.name, path: join(directory, `${call.name}.lock`) }
    await acquire(lock)
    try {
      return await call.run()
    } finally {
      await removeIfStill({ path: lock.path, raw: String(process.pid) })
    }
  }
}
