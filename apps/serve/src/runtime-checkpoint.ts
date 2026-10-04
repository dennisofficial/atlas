import { randomUUID } from 'node:crypto'

import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import {
  persistRuntimeCheckpoint,
  readPersistedRuntimeCheckpoint,
  runtimeCheckpointFile,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'
import { ERuntimePhase, EServeEnv, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'

export const SANDBOX_SESSION_ID_ENV = 'ATLAS_SANDBOX_SESSION_ID'

const CHECKPOINT_MIRROR_TIMEOUT_MS = 5_000

const PROGRESS_MIRROR_CADENCE_MS = 1_000

export type RuntimeCheckpointDeps = {
  threadId: ThreadId
  atlasHome: string
  env: Record<string, string | undefined>
  token: string
  transcript: Pick<EventLogPort, 'read'>
  log: ServeLog
  fetchFn?: typeof fetch | undefined
  runtimeId?: string | undefined
  now?: (() => number) | undefined
}

export type RuntimeCheckpointCapture = {
  capture(args: { phase: ERuntimePhase }): Promise<RuntimeCheckpoint | null>
  changed(): void
  flush(args: { timeoutMs: number }): Promise<void>
  readPersisted(): Promise<RuntimeCheckpoint | null>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function createRuntimeCheckpointCapture(
  deps: RuntimeCheckpointDeps,
): RuntimeCheckpointCapture {
  const file = runtimeCheckpointFile({ atlasHome: deps.atlasHome })
  const runtimeId = deps.runtimeId ?? randomUUID()
  const fetchFn = deps.fetchFn ?? fetch
  const now = deps.now ?? Date.now
  const cloudURL = (deps.env[EServeEnv.CloudUrl] ?? '').trim().replace(/\/+$/, '')
  const sessionId = (deps.env[SANDBOX_SESSION_ID_ENV] ?? '').trim()
  const publishable = sessionId.length > 0

  let sealed = false
  let captures: Promise<void> = Promise.resolve()
  let capturing: Promise<void> | null = null
  let pendingPhase: ERuntimePhase | null = null
  let mirrorChain: Promise<void> = Promise.resolve()
  let mirrorActive = false
  let queuedMirror: RuntimeCheckpoint | null = null
  let lastMirrorAt: number | null = null
  let registrationMissing = false
  let deferredDrain: ReturnType<typeof setTimeout> | null = null

  const noteUnpublishable = (): void => {
    deps.log({
      event: EServeEvent.CheckpointUnpublishable,
      reason: `${SANDBOX_SESSION_ID_ENV} is unset, so this runtime never publishes a checkpoint`,
    })
  }

  const sendMirror = async (checkpoint: RuntimeCheckpoint): Promise<void> => {
    try {
      const response = await fetchFn(`${cloudURL}/v1/sandboxes/${deps.threadId}/checkpoint`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${deps.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(checkpoint),
        signal: AbortSignal.timeout(CHECKPOINT_MIRROR_TIMEOUT_MS),
      })
      if (response.status === 404) {
        registrationMissing = true
        deps.log({
          event: EServeEvent.CheckpointMirrorFailed,
          revision: checkpoint.revision,
          reason: 'the control plane has no sandbox row for this thread yet',
        })
        return
      }
      if (!response.ok) {
        deps.log({
          event: EServeEvent.CheckpointMirrorFailed,
          revision: checkpoint.revision,
          reason: `the control plane answered the checkpoint mirror with ${response.status}`,
        })
        return
      }
      registrationMissing = false
    } catch (error: unknown) {
      deps.log({
        event: EServeEvent.CheckpointMirrorFailed,
        revision: checkpoint.revision,
        reason: messageOf(error),
      })
    }
  }

  const offerMirror = (checkpoint: RuntimeCheckpoint): void => {
    if (queuedMirror?.phase !== ERuntimePhase.Parked) queuedMirror = checkpoint
  }

  const ensureMirrorLatch = (): void => {
    if (mirrorActive) return
    mirrorActive = true
    mirrorChain = (async () => {
      while (queuedMirror !== null) {
        const next = queuedMirror
        queuedMirror = null
        lastMirrorAt = now()
        await sendMirror(next)
      }
    })().finally(() => {
      mirrorActive = false
    })
  }

  const scheduleDeferredDrain = (): void => {
    if (deferredDrain !== null) return
    deferredDrain = setTimeout(() => {
      deferredDrain = null
      if (queuedMirror !== null) ensureMirrorLatch()
    }, PROGRESS_MIRROR_CADENCE_MS)
    deferredDrain.unref?.()
  }

  const mirrorNow = (checkpoint: RuntimeCheckpoint): void => {
    if (cloudURL.length === 0) return
    const due =
      checkpoint.phase === ERuntimePhase.Parked ||
      registrationMissing ||
      lastMirrorAt === null ||
      now() - lastMirrorAt >= PROGRESS_MIRROR_CADENCE_MS
    offerMirror(checkpoint)
    if (due) {
      ensureMirrorLatch()
      return
    }
    scheduleDeferredDrain()
  }

  const persistCapture = async (args: {
    phase: ERuntimePhase
  }): Promise<RuntimeCheckpoint | null> => {
    if (sealed) return null
    if (!publishable) {
      noteUnpublishable()
      return null
    }
    const events = await deps.transcript.read({ threadId: deps.threadId })
    const persisted = await readPersistedRuntimeCheckpoint({ file })
    const checkpoint: RuntimeCheckpoint = {
      threadId: deps.threadId,
      runtimeId,
      sandboxSessionId: sessionId,
      revision: (persisted?.revision ?? 0) + 1,
      phase: args.phase,
      reportedAt: new Date(now()).toISOString(),
      transcript: {
        head: events.at(-1)?.seq ?? 0,
        count: events.length,
        digest: transcriptIdentityDigest(events),
      },
    }
    try {
      await persistRuntimeCheckpoint({ file, checkpoint })
    } catch (error: unknown) {
      deps.log({
        event: EServeEvent.CheckpointPersistFailed,
        revision: checkpoint.revision,
        reason: messageOf(error),
      })
      throw error
    }
    if (args.phase === ERuntimePhase.Parked || args.phase === ERuntimePhase.Rotating) sealed = true
    mirrorNow(checkpoint)
    return checkpoint
  }

  const capture = (args: { phase: ERuntimePhase }): Promise<RuntimeCheckpoint | null> => {
    const capturing = captures.then(() => persistCapture(args))
    captures = capturing.then(
      () => undefined,
      () => undefined,
    )
    return capturing
  }

  const changed = (): void => {
    if (sealed) return
    pendingPhase = ERuntimePhase.Running
    if (capturing !== null) return
    capturing = (async (): Promise<void> => {
      while (pendingPhase !== null) {
        pendingPhase = null
        await capture({ phase: ERuntimePhase.Running }).catch(() => null)
      }
    })().finally(() => {
      capturing = null
    })
  }

  const flush = async (args: { timeoutMs: number }): Promise<void> => {
    await Promise.allSettled([captures, capturing ?? Promise.resolve()])
    if (cloudURL.length > 0 && queuedMirror !== null) ensureMirrorLatch()
    const timer = new Promise<'expired'>((resolve) => {
      const handle = setTimeout(() => resolve('expired'), args.timeoutMs)
      handle.unref?.()
      void mirrorChain.finally(() => clearTimeout(handle))
    })
    const outcome = await Promise.race([mirrorChain.then((): 'settled' => 'settled'), timer])
    if (outcome === 'expired') {
      deps.log({
        event: EServeEvent.CheckpointMirrorFailed,
        reason: `the checkpoint mirror did not settle within ${args.timeoutMs}ms of the park flush`,
      })
    }
  }

  const readPersisted = async (): Promise<RuntimeCheckpoint | null> => {
    if (!publishable) return null
    const persisted = await readPersistedRuntimeCheckpoint({ file })
    if (persisted === null) return null
    if (persisted.threadId !== deps.threadId) return null
    if (persisted.sandboxSessionId !== sessionId) return null
    return persisted
  }

  return { capture, changed, flush, readPersisted }
}
