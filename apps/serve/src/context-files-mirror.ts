import type { ThreadId } from '@dltech/atlas-core'
import { watchContextDirectory, type WatchSeams } from '@dltech/atlas-harness'
import { mirrorsThreadState } from '@dltech/atlas-wire'

import { type ApiRemote, createApiClient } from './api-client'
import {
  createContextFilesFlusher,
  type ContextFilesFlusher,
  type DeleteContextFile,
  type DeleteMissingContextFiles,
  type PutContextFile,
  type ScanContextTree,
} from './context-files-flush'
import { EServeEvent, type ServeLog } from './serve-log'

export const CONTEXT_MIRROR_DEBOUNCE_MS = 1_000

export type ContextFilesMirror = {
  flush: () => Promise<boolean>
  detach: () => void
}

export function bindContextFilesMirror(args: {
  env: Record<string, string | undefined>
  threadId: ThreadId
  sessionDir: string
  contextRoot: string
  remote: ApiRemote
  log: ServeLog
  watchSeams?: WatchSeams | undefined
  scan?: ScanContextTree | undefined
  debounceMs?: number | undefined
  schedule?: ((task: () => void, delayMs: number) => () => void) | undefined
  put?: PutContextFile | undefined
  remove?: DeleteContextFile | undefined
  deleteMissing?: DeleteMissingContextFiles | undefined
}): ContextFilesMirror | undefined {
  if (!mirrorsThreadState(args.env)) return undefined
  const { threadId, log } = args
  const client = createApiClient(args.remote)
  const put =
    args.put ??
    (async ({ path, content }: { path: string; content: string }) => {
      await client.sandboxSelf.putContextFile.mutate({ path, content })
    })
  const remove =
    args.remove ??
    (async ({ path }: { path: string }) => {
      await client.sandboxSelf.deleteContextFile.mutate({ path })
    })
  const deleteMissing =
    args.deleteMissing ??
    (async ({ keep }: { keep: readonly string[] }) => {
      await client.sandboxSelf.deleteMissingContextFiles.mutate({ keep: [...keep] })
    })
  const flusher: ContextFilesFlusher = createContextFilesFlusher({
    threadId,
    root: args.contextRoot,
    put,
    remove,
    deleteMissing,
    scan: args.scan,
    log,
  })

  const debounceMs = args.debounceMs ?? CONTEXT_MIRROR_DEBOUNCE_MS
  const schedule =
    args.schedule ??
    ((task: () => void, delayMs: number): (() => void) => {
      const timer = setTimeout(task, delayMs)
      timer.unref()
      return () => clearTimeout(timer)
    })

  let pending = false
  let timerCancel: (() => void) | undefined
  let inFlight: Promise<boolean> | undefined
  let rerun = false

  const run = (): void => {
    if (inFlight !== undefined) {
      rerun = true
      return
    }
    inFlight = flusher.flush().finally(() => {
      inFlight = undefined
      if (rerun) {
        rerun = false
        queue()
      }
    })
  }

  const queue = (): void => {
    pending = true
    timerCancel?.()
    timerCancel = schedule(() => {
      timerCancel = undefined
      if (!pending) return
      pending = false
      run()
    }, debounceMs)
  }

  const unwatch = watchContextDirectory({
    sessionDir: args.sessionDir,
    onChange: queue,
    catchUp: true,
    ...args.watchSeams,
  })
  void flusher.flush().then((stored) => {
    if (stored) log({ event: EServeEvent.ContextMirrored, threadId })
  })

  return {
    flush: async () => {
      timerCancel?.()
      timerCancel = undefined
      pending = false
      if (inFlight !== undefined) await inFlight
      return flusher.flush()
    },
    detach: () => {
      timerCancel?.()
      timerCancel = undefined
      pending = false
      unwatch()
    },
  }
}
