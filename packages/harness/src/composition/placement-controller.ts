import {
  EHarnessPlacement,
  type PlacementRecord,
  type ThreadId,
} from '@dltech/atlas-core'

import {
  PlacementBusy,
  type PlacementCommit,
  type PlacementSessionAuthority,
  type PlacementStore,
} from './placement-controller-types'

export * from './placement-controller-types'

/**
 * The placement substrate: the durable record's compare-and-swap write discipline and the cloud
 * birth's commit handle. A thread with no record is unplaced; birth is the only writer.
 */
const UNPLACED: PlacementRecord = { placement: { harness: EHarnessPlacement.Cloud }, revision: 0 }

export class PlacementController {
  private active: ThreadId | undefined
  private readonly records = new Map<ThreadId, PlacementRecord>()
  private readonly listeners = new Set<() => void>()
  private readonly moving = new Set<ThreadId>()
  private readonly gates = new Set<(args: { threadId: ThreadId; record: PlacementRecord }) => void>()
  private binding: {
    threads: PlacementStore
    workspace: string
    repo: string | null
    authority?: PlacementSessionAuthority | undefined
  } | undefined

  readonly activeThread = (): ThreadId | undefined => this.active

  readonly beforePublish = (gate: (args: { threadId: ThreadId; record: PlacementRecord }) => void): (() => void) => {
    this.gates.add(gate)
    return () => this.gates.delete(gate)
  }

  readonly snapshot = (threadId: ThreadId): PlacementRecord | undefined => this.records.get(threadId)

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  bind(binding: {
    threads: PlacementStore
    workspace: string
    repo: string | null
    authority?: PlacementSessionAuthority | undefined
  }): void {
    if (this.binding !== undefined) throw new Error('placement is already bound to its store')
    this.binding = binding
    binding.threads.onPlacementChanged(({ threadId, record }) => this.publish({ threadId, record }))
  }

  async activate(args: { threadId: ThreadId }): Promise<void> {
    this.active = args.threadId
    await this.load(args)
    this.notify()
  }

  async load(args: { threadId: ThreadId }): Promise<PlacementRecord | undefined> {
    const record =
      (await this.binding?.threads.readPlacement({ threadId: args.threadId })) ?? this.records.get(args.threadId)
    if (record !== undefined) this.publish({ threadId: args.threadId, record })
    return record
  }

  /**
   * Stamps the placement a cloud birth settled on. A cloud birth is the initial provisioning
   * itself — a placement write, not a move — so the caller drives the provisioning and commits the
   * resulting placement through the returned handle once it has the drive name.
   */
  async birth<T>(args: {
    threadId: ThreadId
    work: (commit: PlacementCommit) => Promise<T>
  }): Promise<T> {
    const binding = this.binding
    if (binding === undefined) throw new Error('placement has no durable store')
    const session = await this.sessionRoot(args.threadId)
    if (this.moving.has(session)) throw new PlacementBusy()
    this.moving.add(session)
    try {
      const record = (await this.load({ threadId: args.threadId })) ?? UNPLACED
      let committed = false
      let current = record
      const handle: PlacementCommit = {
        committed: () => committed,
        commit: async (placement) => {
          if (committed) return
          current = await this.write({
            threadId: args.threadId,
            prior: current,
            next: { placement, revision: current.revision },
          })
          committed = true
        },
      }
      return await args.work(handle)
    } finally {
      this.moving.delete(session)
    }
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

  private async sessionRoot(threadId: ThreadId): Promise<ThreadId> {
    const authority = this.binding?.authority
    if (authority !== undefined) {
      const active = await authority.activeMainOf({ sessionId: threadId })
      if (active !== undefined) return active
    }
    return this.supervisionRoot(threadId)
  }

  private async supervisionRoot(threadId: ThreadId): Promise<ThreadId> {
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
