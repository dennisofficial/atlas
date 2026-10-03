import { constants, watch, type FSWatcher } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

import { SPOOL_READ_BYTES } from './protocol'

export type Waker = {
  wait: () => Promise<void>
  nudge: () => void
  close: () => void
}

/**
 * fs.watch can drop or coalesce events (and does nothing useful on some bind mounts), so every wait is
 * also bounded by a poll timer: a missed event costs at most pollMs of latency, never correctness.
 */
export function createWaker({ directory, pollMs }: { directory: string; pollMs: number }): Waker {
  const waiters = new Set<() => void>()
  let watcher: FSWatcher | undefined
  let closed = false

  const nudge = (): void => {
    for (const release of [...waiters]) release()
  }

  try {
    watcher = watch(directory, { persistent: false }, nudge)
    watcher.on('error', () => {
      watcher?.close()
      watcher = undefined
    })
  } catch {
    watcher = undefined
  }

  return {
    wait: () =>
      new Promise<void>((resolve) => {
        if (closed) return resolve()
        const release = (): void => {
          clearTimeout(timer)
          waiters.delete(release)
          resolve()
        }
        const timer = setTimeout(release, pollMs)
        waiters.add(release)
      }),
    nudge,
    close: () => {
      closed = true
      watcher?.close()
      nudge()
    },
  }
}

export type SpoolEnd = { kind: 'running' } | { kind: 'ended'; bytes: number | undefined }

export type SpoolReader = {
  stream: ReadableStream<Uint8Array>
  offset: () => number
}

export function createSpoolReader({
  spoolPath,
  cursor,
  waker,
  endOf,
  sizeOf,
}: {
  spoolPath: string
  cursor: number
  waker: Waker
  endOf: () => SpoolEnd
  sizeOf: () => Promise<number>
}): SpoolReader {
  let offset = cursor
  let cancelled = false

  const readAt = async ({ length }: { length: number }): Promise<Uint8Array> => {
    const handle: FileHandle = await open(spoolPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const buffer = new Uint8Array(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        for (;;) {
          if (cancelled) return
          const end = endOf()
          const size = await sizeOf()
          const limit = end.kind === 'ended' && end.bytes !== undefined ? Math.min(size, end.bytes) : size
          if (offset < limit) {
            const length = Math.min(SPOOL_READ_BYTES, limit - offset)
            const bytes = await readAt({ length })
            if (bytes.length === 0) continue
            offset += bytes.length
            controller.enqueue(bytes)
            return
          }
          if (end.kind === 'ended') {
            controller.close()
            return
          }
          await waker.wait()
        }
      },
      async cancel() {
        cancelled = true
        waker.nudge()
      },
    },
    { highWaterMark: 0 },
  )

  return { stream, offset: () => offset }
}

export const emptyStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })

export const inertWaker = (): Waker => ({ wait: () => Promise.resolve(), nudge: () => undefined, close: () => undefined })
