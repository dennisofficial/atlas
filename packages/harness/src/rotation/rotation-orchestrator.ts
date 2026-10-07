import { saidBody, toThreadId, type ThreadId } from '@dltech/atlas-core'

import { ERotationStatus, type RotationRecord } from '../store/sessions/meta'

import { liveManifest, renderHandoff, successorSeedText, type HandoffManifest } from './handoff-render'
import { watermarkHead } from './handoff-summary'
import { reconcileNotifications } from './reconcile-notices'
import { openInflight, type InflightRotation } from './rotation-inflight'
import { rotationRecordOf, rotationStore, type RotationStore } from './rotation-records'
import {
  ERotationPhase,
  RotationBusy,
  RotationPort,
  type RotationListener,
  type RotationOutcome,
  type RotationSettle,
  type RotationStage,
  type RotationStatus,
} from './rotation-port'
import type { RotationDeps } from './rotation-deps'

const NOT_ACTIVE_MAIN = 'the thread is not the session’s active main'

type Inflight = InflightRotation

export class LocalRotation extends RotationPort {
  private readonly inflight = new Map<string, Inflight>()
  private readonly listeners = new Set<RotationListener>()
  private readonly store: RotationStore

  constructor(private readonly deps: RotationDeps) {
    super()
    this.store = rotationStore({ authority: deps.authority, registry: deps.registry, clock: deps.clock })
  }

  subscribe(listener: RotationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async status(args: { sessionId: string }): Promise<RotationStatus> {
    const held = this.inflight.get(args.sessionId)
    if (held !== undefined) return statusOfInflight({ sessionId: args.sessionId, held })
    const record = await this.store.recordOf({ sessionId: args.sessionId })
    if (record === undefined) return { kind: 'idle' }
    return statusOfRecord({ sessionId: args.sessionId, record })
  }

  async recover(args: {
    sessionId: string
    activate?: (() => Promise<void>) | undefined
  }): Promise<RotationStatus> {
    const record = await this.store.recordOf({ sessionId: args.sessionId })
    if (record === undefined) return { kind: 'idle' }

    if (record.status === ERotationStatus.Preparing) {
      await this.deps.authority.recoverInterruptedRotation({ sessionId: args.sessionId })
      return { kind: 'idle' }
    }
    if (record.status !== ERotationStatus.Committed) return { kind: 'idle' }

    const successor = toThreadId(record.successor)
    const fence = await this.deps.authority.fenceMainThread({ threadId: successor })
    if (!fence.allowed) return { kind: 'idle' }

    await reconcileNotifications({
      log: this.deps.log,
      ids: this.deps.ids,
      agents: this.deps.agents,
      shells: this.deps.shells,
      services: this.deps.services,
      predecessor: toThreadId(record.predecessor),
      successor,
    })
    if (args.activate !== undefined) await args.activate()
    else void this.deps.runner.runTurn({ threadId: successor })
    return this.status(args)
  }

  async request(args: {
    sessionId: string
    predecessor: ThreadId
    instructions: string
    settle: RotationSettle
  }): Promise<RotationOutcome> {
    if (this.inflight.has(args.sessionId)) throw new RotationBusy({ sessionId: args.sessionId })

    const operation: Inflight = openInflight({
      operationId: this.deps.ids.nextRunId(),
      predecessor: args.predecessor,
    })
    this.inflight.set(args.sessionId, operation)
    try {
      return await this.open({ ...args, operation })
    } finally {
      this.inflight.delete(args.sessionId)
    }
  }

  private async open(args: {
    sessionId: string
    predecessor: ThreadId
    instructions: string
    settle: RotationSettle
    operation: Inflight
  }): Promise<RotationOutcome> {
    const { sessionId, predecessor, operation } = args
    const active = await this.deps.authority.activeMainOf({ sessionId })
    if (active !== predecessor) {
      return { kind: 'failed', sessionId, operationId: operation.operationId, reason: NOT_ACTIVE_MAIN }
    }
    const prior = await this.store.recordOf({ sessionId })
    if (prior !== undefined && prior.status === ERotationStatus.Preparing) {
      throw new RotationBusy({ sessionId })
    }
    return this.drive(args)
  }

  private async drive(args: {
    sessionId: string
    predecessor: ThreadId
    instructions: string
    settle: RotationSettle
    operation: Inflight
  }): Promise<RotationOutcome> {
    const { sessionId, predecessor, instructions, settle, operation } = args

    this.advance({ sessionId, operation, phase: ERotationPhase.Settling })
    settle.pause()
    await settle.waitSettled()

    try {
      return await this.prepareCommitActivate({ sessionId, predecessor, instructions, operation })
    } catch (fault) {
      const reason = fault instanceof Error ? fault.message : String(fault)
      await this.store.markFailed({ sessionId, predecessor })
      this.advance({ sessionId, operation, phase: ERotationPhase.Failed, detail: reason })
      return { kind: 'failed', sessionId, operationId: operation.operationId, reason }
    }
  }

  private async prepareCommitActivate(args: {
    sessionId: string
    predecessor: ThreadId
    instructions: string
    operation: Inflight
  }): Promise<RotationOutcome> {
    const { sessionId, predecessor, instructions, operation } = args

    const events = await this.deps.log.read({ threadId: predecessor })
    const watermark = watermarkHead({ events })
    if (watermark === undefined) {
      throw new Error('the predecessor transcript is empty — nothing to hand off')
    }
    operation.watermarkSeq = watermark

    const successor = this.deps.ids.nextThreadId()
    operation.successor = successor

    const handoff = await this.store.handoffPathFor({ sessionId, operationId: operation.operationId })

    await this.store.writeRecord({
      sessionId,
      write: {
        rotation: this.record({ predecessor, successor, handoffPath: handoff.path, watermark, status: ERotationStatus.Preparing }),
        expectedActiveMain: predecessor,
      },
    })

    this.advance({ sessionId, operation, phase: ERotationPhase.Summarising })
    const narrative = await this.deps.summarise({ events, fromSeq: 0, throughSeq: watermark, instructions })
    if (narrative === null) {
      throw new Error('the handoff summary came back empty')
    }

    const manifest = this.carriedManifest({ predecessor })
    const contents = renderHandoff({ narrative, instructions, manifest, predecessor, successor, watermarkSeq: watermark })
    await this.store.persistHandoff({ path: handoff.path, dir: handoff.dir, contents })

    this.advance({ sessionId, operation, phase: ERotationPhase.Preparing })
    const seed = successorSeedText({ instructions, handoffPath: handoff.path, manifest, operationId: operation.operationId })
    await this.deps.threads.createWithFirstEvents({
      threadId: successor,
      sessionId,
      drafts: [saidBody({ text: seed })],
      runId: this.deps.ids.nextRunId(),
      title: `Rotation of ${predecessor}`,
      workspace: this.deps.workspace,
      repo: this.deps.repo,
    })

    this.advance({ sessionId, operation, phase: ERotationPhase.Committing })
    await this.store.writeRecord({
      sessionId,
      write: {
        rotation: this.record({ predecessor, successor, handoffPath: handoff.path, watermark, status: ERotationStatus.Committed }),
        expectedActiveMain: predecessor,
        nextActiveMain: successor,
      },
    })

    await reconcileNotifications({
      log: this.deps.log,
      ids: this.deps.ids,
      agents: this.deps.agents,
      shells: this.deps.shells,
      services: this.deps.services,
      predecessor,
      successor,
    })

    this.advance({ sessionId, operation, phase: ERotationPhase.Activating })
    void this.deps.runner.runTurn({ threadId: successor })
    this.advance({ sessionId, operation, phase: ERotationPhase.Committed })

    return {
      kind: 'committed',
      sessionId,
      operationId: operation.operationId,
      predecessor,
      successor,
      handoffPath: handoff.path,
      watermarkSeq: watermark,
    }
  }

  private carriedManifest({ predecessor }: { predecessor: ThreadId }): HandoffManifest {
    return liveManifest({
      agents: this.deps.agents.list({ threadId: predecessor }),
      shells: this.deps.shells.list({ threadId: predecessor }),
      services: this.deps.services.list(),
    })
  }

  private record(args: {
    predecessor: ThreadId
    successor: ThreadId
    handoffPath: string
    watermark: number
    status: ERotationStatus
  }): RotationRecord {
    return rotationRecordOf({ ...args, clock: this.deps.clock })
  }

  private advance(args: {
    sessionId: string
    operation: Inflight
    phase: ERotationPhase
    detail?: string | undefined
  }): void {
    args.operation.phase = args.phase
    this.emit({ sessionId: args.sessionId, operationId: args.operation.operationId, phase: args.phase, detail: args.detail })
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

function statusOfInflight({ sessionId, held }: { sessionId: string; held: Inflight }): RotationStatus {
  return {
    kind: 'active',
    sessionId,
    operationId: held.operationId,
    phase: held.phase,
    predecessor: held.predecessor,
    successor: held.successor,
    watermarkSeq: held.watermarkSeq,
  }
}

function statusOfRecord({ sessionId, record }: { sessionId: string; record: RotationRecord }): RotationStatus {
  if (record.status === ERotationStatus.Failed || record.status === ERotationStatus.Aborted) {
    return { kind: 'idle' }
  }
  return {
    kind: 'active',
    sessionId,
    operationId: record.updatedAt,
    phase: record.status === ERotationStatus.Committed ? ERotationPhase.Committed : ERotationPhase.Preparing,
    predecessor: toThreadId(record.predecessor),
    successor: record.successor === '' ? undefined : toThreadId(record.successor),
    watermarkSeq: record.watermarkSeq,
  }
}
