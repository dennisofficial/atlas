import { randomUUID } from 'node:crypto'

import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import {
  persistRuntimeCheckpoint,
  readPersistedRuntimeCheckpoint,
  runtimeCheckpointFile,
  transcriptIdentityDigest,
} from '@dltech/atlas-harness'
import {
  ERuntimePhase,
  EServeEnv,
  sandboxRotationReceiptSchema,
  type RuntimeCheckpoint,
  type SandboxRotationReceipt,
} from '@dltech/atlas-wire'

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
  capture(args: {
    phase: ERuntimePhase
    attempts?: number | undefined
    resume?: { parent: boolean; children?: readonly string[] | undefined } | undefined
  }): Promise<RuntimeCheckpoint | null>
  /**
   * Zeroes a sealed rotation receipt's obligations through the same serialized write chain as the
   * captures, so a cadence capture can never clobber a consumption nor the other way around.
   */
  consumeReceipt(args: {
    parent?: boolean
    children?: readonly string[] | undefined
  }): Promise<void>
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

  const mirrorImmediately = (phase: ERuntimePhase): boolean =>
    phase === ERuntimePhase.Parking ||
    phase === ERuntimePhase.Parked ||
    phase === ERuntimePhase.Updating

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
      mirrorImmediately(checkpoint.phase) ||
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

  const rotationReceiptOf = (args: {
    checkpoint: {
      threadId: string
      sandboxSessionId: string
      phase: ERuntimePhase.Updating
      revision: number
      runtimeId: string
      reportedAt: string
      transcript: RuntimeCheckpoint['transcript']
    }
    resume: { parent: boolean; children?: readonly string[] | undefined }
  }): SandboxRotationReceipt =>
    sandboxRotationReceiptSchema.parse({
      version: 1,
      threadId: args.checkpoint.threadId,
      sandboxSessionId: args.checkpoint.sandboxSessionId,
      resumeParent: args.resume.parent,
      ...(args.resume.children === undefined ? {} : { resumeChildren: [...args.resume.children] }),
      checkpoint: args.checkpoint,
    })

  const persistCapture = async (args: {
    phase: ERuntimePhase
    attempts?: number | undefined
    resume?: { parent: boolean; children?: readonly string[] | undefined } | undefined
  }): Promise<RuntimeCheckpoint | null> => {
    if (sealed) return null
    if (!publishable) {
      noteUnpublishable()
      return null
    }
    const events = await deps.transcript.read({ threadId: deps.threadId })
    const persisted = await readPersistedRuntimeCheckpoint({ file })
    const base = {
      threadId: deps.threadId,
      runtimeId,
      sandboxSessionId: sessionId,
      revision: (persisted?.revision ?? 0) + 1,
      reportedAt: new Date(now()).toISOString(),
      transcript: {
        head: events.at(-1)?.seq ?? 0,
        count: events.length,
        digest: transcriptIdentityDigest(events),
      },
    }
    let checkpoint: RuntimeCheckpoint
    if (args.phase === ERuntimePhase.Parking) {
      checkpoint = {
        ...base,
        phase: ERuntimePhase.Parking,
        ...(args.attempts === undefined ? {} : { park: { attempts: args.attempts } }),
      }
    } else if (args.phase === ERuntimePhase.Updating) {
      if (args.resume === undefined) {
        throw new Error('an updating capture requires its rotation resume payload')
      }
      const updatingBase = { ...base, phase: ERuntimePhase.Updating as const }
      checkpoint = {
        ...updatingBase,
        receipt: rotationReceiptOf({ checkpoint: updatingBase, resume: args.resume }),
      }
    } else {
      const owedReceipt =
        persisted?.phase === ERuntimePhase.Updating || persisted?.phase === ERuntimePhase.Serving
          ? persisted.receipt
          : undefined
      const owedCarries =
        args.phase === ERuntimePhase.Serving &&
        owedReceipt !== undefined &&
        (owedReceipt.resumeParent || (owedReceipt.resumeChildren ?? []).length > 0)
      checkpoint = owedCarries
        ? { ...base, phase: args.phase, receipt: owedReceipt }
        : { ...base, phase: args.phase }
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
    if (args.phase === ERuntimePhase.Parked || args.phase === ERuntimePhase.Updating) sealed = true
    mirrorNow(checkpoint)
    return checkpoint
  }

  const capture: RuntimeCheckpointCapture['capture'] = (args) => {
    const capturing = captures.then(() => persistCapture(args))
    captures = capturing.then(
      () => undefined,
      () => undefined,
    )
    return capturing
  }

  const persistReceiptConsumption = async (args: {
    parent?: boolean
    children?: readonly string[] | undefined
  }): Promise<void> => {
    const persisted = await readPersistedRuntimeCheckpoint({ file })
    if (
      persisted === null ||
      (persisted.phase !== ERuntimePhase.Updating && persisted.phase !== ERuntimePhase.Serving)
    ) {
      return
    }
    const owed = persisted.receipt
    if (owed === undefined) return
    const consumed = {
      ...owed,
      ...(args.parent === true ? { resumeParent: false } : {}),
      ...(args.children === undefined
        ? {}
        : {
            resumeChildren: (owed.resumeChildren ?? []).filter(
              (child) => !args.children?.includes(child),
            ),
          }),
    }
    if (JSON.stringify(consumed) === JSON.stringify(owed)) return
    const discharged = !consumed.resumeParent && (consumed.resumeChildren ?? []).length === 0
    const { receipt: _owed, ...rest } = persisted
    const next = { ...rest, revision: persisted.revision + 1 }
    if (persisted.phase === ERuntimePhase.Updating) {
      await persistRuntimeCheckpoint({
        file,
        checkpoint: { ...next, phase: ERuntimePhase.Updating, receipt: consumed },
      })
      return
    }
    await persistRuntimeCheckpoint({
      file,
      checkpoint: discharged
        ? { ...next, phase: ERuntimePhase.Serving }
        : { ...next, phase: ERuntimePhase.Serving, receipt: consumed },
    })
  }

  const consumeReceipt: RuntimeCheckpointCapture['consumeReceipt'] = (args) => {
    const consuming = captures.then(() => persistReceiptConsumption(args))
    captures = consuming.then(
      () => undefined,
      () => undefined,
    )
    return consuming
  }

  const changed = (): void => {
    if (sealed) return
    pendingPhase = ERuntimePhase.Serving
    if (capturing !== null) return
    capturing = (async (): Promise<void> => {
      while (pendingPhase !== null) {
        pendingPhase = null
        await capture({ phase: ERuntimePhase.Serving }).catch(() => null)
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

  return { capture, consumeReceipt, changed, flush, readPersisted }
}
