import { randomUUID } from 'node:crypto'
import { lstat, open, readFile, unlink, type FileHandle } from 'node:fs/promises'
import { resolve } from 'node:path'

const pending = new Map<string, Promise<void>>()
const acquisitionBudgetMs = 2_000
const retryIntervalMs = 25

export type ActivityFileLockOptions<T> = {
  path: string
  run: () => Promise<T> | T
  timeoutMs?: number
}

export class ActivityFileLockUnavailableError extends Error {
  constructor({ path, reason, cause }: { path: string; reason: string; cause?: unknown }) {
    super(`${reason}: ${path}`, { cause })
    this.name = 'ActivityFileLockUnavailableError'
  }
}

export async function withActivityFileLock<T>({
  path,
  run,
  timeoutMs = acquisitionBudgetMs,
}: ActivityFileLockOptions<T>): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Activity file lock timeoutMs must be positive and finite')
  }
  path = resolve(path)
  const deadline = performance.now() + Math.min(timeoutMs, acquisitionBudgetMs)
  const previous = pending.get(path) ?? Promise.resolve()
  const completion = Promise.withResolvers<void>()
  const tail = previous.then(() => completion.promise)
  pending.set(path, tail)
  try {
    await waitForTurn({ path, previous, deadline })
    return await runLocked({ path, run, deadline })
  } finally {
    completion.resolve()
    void tail.then(() => {
      if (pending.get(path) === tail) pending.delete(path)
    })
  }
}

function timedOut(path: string): ActivityFileLockUnavailableError {
  return new ActivityFileLockUnavailableError({
    path,
    reason: 'Timed out acquiring activity file lock',
  })
}

async function waitForTurn({
  path,
  previous,
  deadline,
}: {
  path: string
  previous: Promise<void>
  deadline: number
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timedOut(path)), Math.max(0, deadline - performance.now()))
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function acquire({ path, deadline }: { path: string; deadline: number }) {
  while (performance.now() < deadline) {
    try {
      return await open(path, 'wx', 0o600)
    } catch (cause) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') {
        throw new ActivityFileLockUnavailableError({
          path,
          reason: 'Could not acquire activity file lock',
          cause,
        })
      }
      const remaining = deadline - performance.now()
      if (remaining <= 0) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(retryIntervalMs, remaining)))
    }
  }
  throw timedOut(path)
}

async function release({
  path,
  file,
  claim,
}: {
  path: string
  file: FileHandle
  claim: string
}): Promise<void> {
  try {
    const owned = await file.stat()
    const current = await lstat(path)
    if (
      !current.isFile() ||
      owned.dev !== current.dev ||
      owned.ino !== current.ino ||
      (await readFile(path, 'utf8')) !== claim
    ) {
      throw new Error('Activity file lock ownership changed')
    }
    await unlink(path)
  } catch (cause) {
    throw new ActivityFileLockUnavailableError({
      path,
      reason: 'Could not release activity file lock',
      cause,
    })
  }
}

async function runLocked<T>({
  path,
  run,
  deadline,
}: ActivityFileLockOptions<T> & { deadline: number }): Promise<T> {
  const claim = JSON.stringify({ token: randomUUID(), pid: process.pid })
  const file = await acquire({ path, deadline })
  try {
    await file.writeFile(claim)
    return await run()
  } finally {
    try {
      await release({ path, file, claim })
    } finally {
      await file.close()
    }
  }
}
