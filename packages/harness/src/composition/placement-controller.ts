import {
  EExecutionLocation,
  EHarnessPlacement,
  EPlacementMovePhase,
  locationOfPlacement,
  placementOf,
  type PlacementMove,
  type PlacementRecord,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'

import { isTeammateType } from '../agents/types'
import type { ThreadStorePort } from '../store/thread-store'

export type PlacementStore = Pick<
  ThreadStorePort,
  'readPlacement' | 'writePlacement' | 'onPlacementChanged' | 'find'
>

export enum EPlacementMoveKind {
  Tools = 'tools',
  Lift = 'lift',
  Descend = 'descend',
  /** A same-placement fill: the record stays put, only its detail (e.g. drive name) is written. */
  Correct = 'correct',
}

export class PlacementBusy extends Error {
  constructor() {
    super('a placement move is already underway for this session')
  }
}

export type PlacementTransaction = {
  from: EExecutionLocation
  committed: () => boolean
  commit: (placement?: SessionPlacement) => Promise<void>
  /**
   * Ends the move without flipping placement, for work that reports its failure as a value rather
   * than throwing it. The preparation marker is cleared and the source placement stands.
   */
  abandon: () => void
}

export class PlacementController {
  private active: ThreadId | undefined
  private readonly records = new Map<ThreadId, PlacementRecord>()
  private readonly listeners = new Set<() => void>()
  private readonly moving = new Set<ThreadId>()
  private readonly startedMoves = new Set<string>()
  private readonly gates = new Set<(args: { threadId: ThreadId; record: PlacementRecord }) => void>()
  private binding: { threads: PlacementStore; workspace: string; repo: string | null } | undefined
  private sequence = 0

  constructor(private readonly initial: EExecutionLocation) {}

  readonly current = (): EExecutionLocation =>
    (this.active === undefined ? undefined : this.of(this.active)) ?? this.initial

  readonly of = (threadId: ThreadId): EExecutionLocation | undefined => {
    const record = this.records.get(threadId)
    return record === undefined ? undefined : locationOfPlacement(record.placement)
  }

  readonly startedHere = (moveId: string): boolean => this.startedMoves.has(moveId)

  readonly activeThread = (): ThreadId | undefined => this.active

  readonly beforePublish = (gate: (args: { threadId: ThreadId; record: PlacementRecord }) => void): (() => void) => {
    this.gates.add(gate)
    return () => this.gates.delete(gate)
  }

  readonly snapshot = (threadId: ThreadId): PlacementRecord | undefined => this.records.get(threadId)

  /**
   * The move underway on this thread, or null. Surfaces freeze their transcript affordances on
   * this rather than on any UI-local move state: it is durable from the first write, so a freeze
   * keyed to it survives the surface remounting across the move.
   */
  readonly moveFor = (threadId: ThreadId): PlacementMove | null =>
    this.records.get(threadId)?.move ?? null

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  bind(binding: { threads: PlacementStore; workspace: string; repo: string | null }): void {
    if (this.binding !== undefined) throw new Error('placement is already bound to its store')
    this.binding = binding
    binding.threads.onPlacementChanged(({ threadId, record }) => this.publish({ threadId, record }))
  }

  async activate(args: { threadId: ThreadId; fallback?: EExecutionLocation | undefined }): Promise<void> {
    this.active = args.threadId
    await this.load(args)
    this.notify()
  }

  async load(args: { threadId: ThreadId; fallback?: EExecutionLocation | undefined }): Promise<PlacementRecord> {
    const record = await this.binding?.threads.readPlacement({ threadId: args.threadId })
    const resolved = record ?? this.records.get(args.threadId) ?? {
      placement: placementOf(args.fallback ?? this.initial),
      revision: 0,
      move: null,
    }
    this.publish({ threadId: args.threadId, record: resolved })
    return resolved
  }

  async refresh({ threadId }: { threadId: ThreadId }): Promise<void> {
    await this.load({ threadId })
  }

  async move<T>(args: {
    threadId: ThreadId
    target: EExecutionLocation
    kind: EPlacementMoveKind
    work: (transaction: PlacementTransaction) => Promise<T>
  }): Promise<T> {
    const binding = this.binding
    if (binding === undefined) throw new Error('placement has no durable store')
    const session = await this.sessionRoot(args.threadId)
    if (this.moving.has(session)) throw new PlacementBusy()
    this.moving.add(session)
    let startedId: string | undefined
    try {
      let record = await this.load({ threadId: args.threadId })
      const from = locationOfPlacement(record.placement)
      this.validate({ ...args, from, record })
      this.sequence += 1
      const id = `${args.threadId}:${record.revision + 1}:${this.sequence}`
      this.startedMoves.add(id)
      startedId = id
      const move: PlacementMove = {
        id,
        from: record.placement,
        to: placementOf(args.target),
        phase: EPlacementMovePhase.Preparing,
      }
      record = await this.write({
        threadId: args.threadId,
        prior: record,
        next: { ...record, move },
      })
      let committed = false
      let abandoned = false
      const transaction: PlacementTransaction = {
        from,
        committed: () => committed,
        abandon: () => {
          abandoned = true
        },
        commit: async (placement = placementOf(args.target)) => {
          if (committed) return
          if (locationOfPlacement(placement) !== args.target) throw new Error('the move committed an unexpected placement')
          record = await this.freshen({ threadId: args.threadId, held: record })
          const next = { ...record, placement, move: { ...move, to: placement, phase: EPlacementMovePhase.Committed } }
          try {
            record = await this.write({ threadId: args.threadId, prior: record, next })
          } catch (error) {
            const stored = await binding.threads.readPlacement({ threadId: args.threadId }).catch(() => undefined)
            if (stored?.move?.id !== move.id || stored.move.phase !== EPlacementMovePhase.Committed) throw error
            record = stored
            this.publish({ threadId: args.threadId, record })
          }
          committed = true
        },
      }
      try {
        const result = await args.work(transaction)
        if (!committed && !abandoned) throw new Error('the move finished without committing placement')
        record = await this.freshen({ threadId: args.threadId, held: record })
        await this.write({ threadId: args.threadId, prior: record, next: { ...record, move: null } })
        return result
      } catch (error) {
        if (!committed) {
          record = await this.freshen({ threadId: args.threadId, held: record })
          await this.write({ threadId: args.threadId, prior: record, next: { ...record, move: null } })
        }
        throw error
      }
    } finally {
      this.moving.delete(session)
      if (startedId !== undefined) this.startedMoves.delete(startedId)
    }
  }

  async recover(args: {
    threadId: ThreadId
    reconcile: (record: PlacementRecord) => Promise<SessionPlacement>
  }): Promise<PlacementRecord> {
    const session = await this.sessionRoot(args.threadId)
    if (this.moving.has(session)) throw new PlacementBusy()
    this.moving.add(session)
    try {
      const record = await this.load({ threadId: args.threadId })
      if (record.move === null) return record
      const placement = await args.reconcile(record)
      return await this.write({ threadId: args.threadId, prior: record, next: { ...record, placement, move: null } })
    } finally {
      this.moving.delete(session)
    }
  }

  private async freshen(args: { threadId: ThreadId; held: PlacementRecord }): Promise<PlacementRecord> {
    const stored = await this.binding?.threads.readPlacement({ threadId: args.threadId })
    if (stored === undefined) return args.held
    if (stored.revision < args.held.revision) return { ...args.held, revision: stored.revision }
    if (stored.move === null && args.held.move !== null) {
      return { ...stored, move: args.held.move }
    }
    return stored
  }

  private async write(args: { threadId: ThreadId; prior: PlacementRecord; next: PlacementRecord }): Promise<PlacementRecord> {
    const binding = this.binding
    if (binding === undefined) throw new Error('placement has no durable store')
    const publishedRevision = this.records.get(args.threadId)?.revision ?? 0
    const record = { ...args.next, revision: Math.max(args.prior.revision, publishedRevision) + 1 }
    await binding.threads.writePlacement({ ...binding, threadId: args.threadId, record, expectedRevision: args.prior.revision })
    this.publish({ threadId: args.threadId, record })
    return record
  }

  private validate(args: { kind: EPlacementMoveKind; from: EExecutionLocation; target: EExecutionLocation; record: PlacementRecord }): void {
    if (args.record.move !== null) throw new Error('this session has an unfinished placement move — recover it before moving again')
    if (args.kind === EPlacementMoveKind.Tools && (args.from === EExecutionLocation.Cloud || args.target === EExecutionLocation.Cloud)) {
      throw new Error('cloud harnesses cannot change their tool environment')
    }
    if (args.kind === EPlacementMoveKind.Lift && args.from === EExecutionLocation.Cloud) throw new Error('this session is already in the cloud — reconnect to it')
    if (args.kind === EPlacementMoveKind.Descend && (args.from !== EExecutionLocation.Cloud || args.target === EExecutionLocation.Cloud)) throw new Error('a descend requires a cloud session and a host destination')
    if (args.kind === EPlacementMoveKind.Correct && args.from !== args.target) throw new Error('a correction cannot move the session')
  }

  private async sessionRoot(threadId: ThreadId): Promise<ThreadId> {
    let root = threadId
    const seen = new Set<ThreadId>()
    while (!seen.has(root)) {
      seen.add(root)
      const thread = await this.binding?.threads.find({ threadId: root })
      if (thread?.agent === undefined) return root
      root = thread.agent.spawnedBy
    }
    throw new Error('the session supervision tree contains a cycle')
  }

  async toolOwner(threadId: ThreadId): Promise<ThreadId> {
    const thread = await this.binding?.threads.find({ threadId })
    if (thread?.agent !== undefined && !isTeammateType(thread.agent.type)) {
      throw new Error('sub-agents follow their owning agent’s tool environment and cannot move it')
    }
    return threadId
  }

  private publish(args: { threadId: ThreadId; record: PlacementRecord }): void {
    const prior = this.records.get(args.threadId)
    if (prior !== undefined && prior.revision > args.record.revision) return
    if (JSON.stringify(prior) === JSON.stringify(args.record)) return
    for (const gate of this.gates) gate(args)
    this.records.set(args.threadId, args.record)
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        continue
      }
    }
  }
}
