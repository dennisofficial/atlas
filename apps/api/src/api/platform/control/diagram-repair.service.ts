import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ControlPlane } from '@dltech/atlas-control'
import { diagramKey, EDiagramRepair, type DiagramRepairOutcome } from '@dltech/atlas-core'
import { db, isUniqueViolation } from '@dltech/atlas-db'
import type {
  DiagramRepairInput,
  DiagramRepairListInput,
  DiagramRepairListOutput,
} from '@dltech/atlas-protocol'

import type { DiagramRepairer } from '../../../agent'

export const DIAGRAM_REPAIRER = Symbol('DIAGRAM_REPAIRER')

export const DIAGRAM_REPAIR_TIMEOUT_MS = 60_000

const UNRECORDED_REASON = 'the repair failed'

const sourceHashOf = (source: string): string =>
  createHash('sha256').update(diagramKey(source)).digest('hex')

type StoredOutcome = { repaired: string | null; reason: string | null }

const outcomeOf = (row: StoredOutcome): DiagramRepairOutcome =>
  row.repaired === null
    ? { kind: EDiagramRepair.Failed, reason: row.reason ?? UNRECORDED_REASON }
    : { kind: EDiagramRepair.Repaired, repaired: row.repaired }

@Injectable()
export class DiagramRepairService {
  private readonly log = new Logger(DiagramRepairService.name)
  private readonly inFlight = new Map<string, Promise<DiagramRepairOutcome>>()

  constructor(
    @Inject(ControlPlane) private readonly plane: ControlPlane,
    @Inject(DIAGRAM_REPAIRER) private readonly repairer: DiagramRepairer,
  ) {}

  async repair(args: { userId: string; input: DiagramRepairInput }): Promise<DiagramRepairOutcome> {
    const { userId, input } = args
    await this.requireOwnedSession({ userId, sessionId: input.sessionId })
    const sourceHash = sourceHashOf(input.source)
    const stored = await this.stored({ sessionId: input.sessionId, sourceHash })
    if (stored !== undefined) return outcomeOf(stored)

    const key = `${input.sessionId}\u0000${sourceHash}`
    const pending = this.inFlight.get(key)
    if (pending !== undefined) return await pending

    const ask = this.repairOnce({ userId, input, sourceHash }).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, ask)
    return await ask
  }

  async list(args: {
    userId: string
    input: DiagramRepairListInput
  }): Promise<DiagramRepairListOutput> {
    await this.requireOwnedSession({ userId: args.userId, sessionId: args.input.sessionId })
    const rows = await db.orm.v2.V2DiagramRepair.where({ sessionId: args.input.sessionId }).all()
    return { repairs: rows.map((row) => ({ source: row.source, outcome: outcomeOf(row) })) }
  }

  private async repairOnce(args: {
    userId: string
    input: DiagramRepairInput
    sourceHash: string
  }): Promise<DiagramRepairOutcome> {
    const { input } = args
    let repaired: { outcome: DiagramRepairOutcome; modelRef: string }
    try {
      repaired = await this.repairer({
        sessionId: input.sessionId,
        source: input.source,
        error: input.error,
        context: input.context,
        signal: AbortSignal.timeout(DIAGRAM_REPAIR_TIMEOUT_MS),
      })
    } catch (failure) {
      this.log.warn(`repairing a diagram in ${input.sessionId} failed: ${String(failure)}`)
      return { kind: EDiagramRepair.Failed, reason: messageOf(failure) }
    }

    const stored = await this.store({
      sessionId: input.sessionId,
      sourceHash: args.sourceHash,
      source: diagramKey(input.source),
      outcome: repaired.outcome,
      modelRef: repaired.modelRef,
    })
    return outcomeOf(stored)
  }

  private async store(args: {
    sessionId: string
    sourceHash: string
    source: string
    outcome: DiagramRepairOutcome
    modelRef: string
  }): Promise<StoredOutcome> {
    const row = {
      sessionId: args.sessionId,
      sourceHash: args.sourceHash,
      source: args.source,
      repaired: args.outcome.kind === EDiagramRepair.Repaired ? args.outcome.repaired : null,
      reason: args.outcome.kind === EDiagramRepair.Failed ? args.outcome.reason : null,
      modelRef: args.modelRef,
    }
    try {
      return await db.orm.v2.V2DiagramRepair.create(row)
    } catch (failure) {
      if (!isUniqueViolation(failure)) throw failure
      const stored = await this.stored({
        sessionId: args.sessionId,
        sourceHash: args.sourceHash,
      })
      return stored ?? row
    }
  }

  private async stored(args: {
    sessionId: string
    sourceHash: string
  }): Promise<StoredOutcome | undefined> {
    const row = await db.orm.v2.V2DiagramRepair.first({
      sessionId: args.sessionId,
      sourceHash: args.sourceHash,
    })
    return row ?? undefined
  }

  private async requireOwnedSession(args: { userId: string; sessionId: string }): Promise<void> {
    const session = await this.plane.readSession({ sessionId: args.sessionId })
    if (session === undefined || session.userId !== args.userId || session.deletedAt !== null) {
      throw new NotFoundException('session not found')
    }
  }
}

const messageOf = (failure: unknown): string => {
  const message = failure instanceof Error ? failure.message : String(failure)
  return message.length === 0 ? UNRECORDED_REASON : message
}
