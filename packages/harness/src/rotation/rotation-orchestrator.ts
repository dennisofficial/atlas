import { ECompactionAnchor, type ThreadId } from '@dltech/atlas-core'

import { compactThread } from '../store/compact'

import type { RotationDeps } from './rotation-deps'
import {
  ERotationPhase,
  RotationBusy,
  RotationPort,
  type RotationListener,
  type RotationOutcome,
  type RotationSettle,
  type RotationStage,
} from './rotation-port'

const NOTHING_TO_ROTATE = 'nothing to rotate: the thread has no events yet'

export class LocalRotation extends RotationPort {
  private readonly inflight = new Set<string>()
  private readonly listeners = new Set<RotationListener>()

  constructor(private readonly deps: RotationDeps) {
    super()
  }

  subscribe(listener: RotationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async request(args: {
    sessionId: string
    threadId: ThreadId
    instructions: string
    settle: RotationSettle
    signal?: AbortSignal | undefined
  }): Promise<RotationOutcome> {
    const { sessionId } = args
    if (this.inflight.has(sessionId)) throw new RotationBusy({ sessionId })

    this.inflight.add(sessionId)
    try {
      return await this.rotate({ ...args, operationId: this.deps.ids.nextRunId() })
    } finally {
      this.inflight.delete(sessionId)
    }
  }

  private async rotate(args: {
    sessionId: string
    operationId: string
    threadId: ThreadId
    instructions: string
    settle: RotationSettle
    signal?: AbortSignal | undefined
  }): Promise<RotationOutcome> {
    const { sessionId, operationId, threadId, instructions, settle, signal } = args
    const advance = (phase: ERotationPhase, detail?: string): void =>
      this.emit({ sessionId, operationId, phase, detail })

    try {
      advance(ERotationPhase.Settling)
      settle.pause()
      await settle.waitSettled()

      const events = await this.deps.log.read({ threadId })
      const watermark = events.at(-1)?.seq
      if (watermark === undefined) {
        advance(ERotationPhase.Failed, NOTHING_TO_ROTATE)
        return { kind: 'refused', reason: NOTHING_TO_ROTATE }
      }

      advance(ERotationPhase.Summarising)
      const compacted = await compactThread({
        log: this.deps.log,
        threads: this.deps.threads,
        agents: this.deps.agents,
        threadId,
        anchor: ECompactionAnchor.Prefix,
        seq: watermark,
        destructive: false,
        signal,
        summarise: async (range) => {
          const brief = await this.deps.summarise({ ...range, instructions })
          advance(ERotationPhase.Compacting)
          return brief
        },
      })

      if (!compacted.ok) {
        advance(ERotationPhase.Failed, compacted.reason)
        return {
          kind: compacted.refusal === undefined ? 'failed' : 'refused',
          reason: compacted.reason,
        }
      }

      advance(ERotationPhase.Done)
      return {
        kind: 'rotated',
        sessionId,
        operationId,
        threadId,
        watermarkSeq: compacted.throughSeq,
        replaced: compacted.replaced,
      }
    } catch (fault) {
      const reason = fault instanceof Error ? fault.message : String(fault)
      advance(ERotationPhase.Failed, reason)
      return { kind: 'failed', reason }
    }
  }

  private emit(stage: RotationStage): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(stage)
      } catch {
        continue
      }
    }
  }
}
