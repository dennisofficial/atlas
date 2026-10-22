import {
  EExecutionLocation,
  EHarnessPlacement,
  locationOfPlacement,
  placementOf,
  type PlacementRecord,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'

import { isTeammateType } from '../agents/types'
import {
  PlacementBusy,
  type PlacementCommit,
  type PlacementSessionAuthority,
  type PlacementStore,
} from './placement-controller-types'

export * from './placement-controller-types'

/**
 * The placement substrate. Placement is fixed at creation and never moves afterwards — the move
 * engine (mid-conversation relocation, the transaction lifecycle, stranded-move recovery) was deleted under
 * GREENFIELD, so what remains is: the durable record's compare-and-swap write discipline, the
 * born-at-creation stamp, the one permitted host↔docker tool-environment rewrite, and the cloud
 * birth's commit handle. Every thread is born-placed; immutability is unconditional.
 */
export class PlacementController {
  private active: ThreadId | undefined
  private readonly records = new Map<ThreadId, PlacementRecord>()
  private readonly listeners = new Set<() => void>()
  private readonly moving = new Set<ThreadId>()
  private readonly gates = new Set<
    (args: { threadId: ThreadId; record: PlacementRecord }) => void
  >()
  private binding:
    | {
        threads: PlacementStore
        workspace: string
        repo: string | null
        authority?: PlacementSessionAuthority | undefined
      }
    | undefined

  constructor(private readonly initial: EExecutionLocation) {}

  readonly current = (): EExecutionLocation =>
    (this.active === undefined ? undefined : this.of(this.active)) ?? this.initial

  readonly of = (threadId: ThreadId): EExecutionLocation | undefined => {
    const record = this.records.get(threadId)
    return record === undefined ? undefined : locationOfPlacement(record.placement)
  }

  readonly activeThread = (): ThreadId | undefined => this.active

  readonly beforePublish = (
    gate: (args: { threadId: ThreadId; record: PlacementRecord }) => void,
  ): (() => void) => {
    this.gates.add(gate)
    return () => this.gates.delete(gate)
  }

  readonly snapshot = (threadId: ThreadId): PlacementRecord | undefined =>
    this.records.get(threadId)

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

  async activate(args: {
    threadId: ThreadId
    fallback?: EExecutionLocation | undefined
  }): Promise<void> {
    this.active = args.threadId
    await this.load(args)
    this.notify()
  }

  async load(args: {
    threadId: ThreadId
    fallback?: EExecutionLocation | undefined
  }): Promise<PlacementRecord> {
    const record = await this.binding?.threads.readPlacement({ threadId: args.threadId })
    const resolved = record ??
      this.records.get(args.threadId) ?? {
        placement: placementOf(args.fallback ?? this.initial),
        revision: 0,
      }
    this.publish({ threadId: args.threadId, record: resolved })
    return resolved
  }

  async refresh({ threadId }: { threadId: ThreadId }): Promise<void> {
    await this.load({ threadId })
  }

  /**
   * Records the placement a thread was born with. Not a move: a thread that already holds a record
   * keeps it, so creation replays are safe.
   */
  async placeAtCreation(args: {
    threadId: ThreadId
    placement: SessionPlacement
  }): Promise<PlacementRecord> {
    const binding = this.binding
    if (binding === undefined) throw new Error('placement has no durable store')
    const known = await binding.threads.find({ threadId: args.threadId })
    const held = await this.load({ threadId: args.threadId })
    // A thread the store already knows already has its truth: its inferred placement stands rather
    // than adopting the suggestion.
    const placement = known !== undefined ? held.placement : args.placement
    return await this.write({
      threadId: args.threadId,
      prior: held,
      next: { placement, revision: held.revision },
    })
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
      const record = await this.load({ threadId: args.threadId })
      let committed = false
      let current = record
      const handle: PlacementCommit = {
        committed: () => committed,
        commit: async (placement) => {
          if (committed) return
          if (placement.harness !== EHarnessPlacement.Cloud) {
            throw new Error('a cloud birth commits a cloud placement')
          }
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

  /**
   * The one permitted placement change: a host session's tool environment (host shell ↔ docker
   * container). Not a relocation — the harness stays on the host, only where its tools run changes,
   * so this is a direct rewrite with the store's compare-and-swap, no transaction lifecycle. The
   * session lock is held for the whole operation, so a concurrent move on the same session is
   * refused while this one's work (pause, settle, relocate) is still running.
   */
  async setToolEnvironment(args: {
    threadId: ThreadId
    target: EExecutionLocation
  }): Promise<PlacementRecord> {
    return this.withToolMove({
      threadId: args.threadId,
      target: args.target,
      work: async (commit) => commit(),
    })
  }

  /**
   * Runs a tool-environment move under the session lock, committing the placement rewrite through
   * the handle the work receives. The work performs the relocation (stopping shells, moving the
   * session) before it commits; a work that throws before committing leaves the placement where it
   * was, which is the move's atomicity guarantee.
   */
  async withToolMove<T>(args: {
    threadId: ThreadId
    target: EExecutionLocation
    work: (commit: () => Promise<PlacementRecord>) => Promise<T>
  }): Promise<T> {
    const binding = this.binding
    if (binding === undefined) throw new Error('placement has no durable store')
    if (args.target === EExecutionLocation.Cloud) {
      throw new Error('cloud harnesses cannot change their tool environment')
    }
    const session = await this.sessionRoot(args.threadId)
    if (this.moving.has(session)) throw new PlacementBusy()
    this.moving.add(session)
    try {
      const record = await this.load({ threadId: args.threadId })
      if (record.placement.harness === EHarnessPlacement.Cloud) {
        throw new Error('cloud harnesses cannot change their tool environment')
      }
      const commit = (): Promise<PlacementRecord> =>
        this.write({
          threadId: args.threadId,
          prior: record,
          next: { placement: placementOf(args.target), revision: record.revision },
        })
      return await args.work(commit)
    } finally {
      this.moving.delete(session)
    }
  }

  private async write(args: {
    threadId: ThreadId
    prior: PlacementRecord
    next: PlacementRecord
  }): Promise<PlacementRecord> {
    const binding = this.binding
    if (binding === undefined) throw new Error('placement has no durable store')
    const publishedRevision = this.records.get(args.threadId)?.revision ?? 0
    const record = { ...args.next, revision: Math.max(args.prior.revision, publishedRevision) + 1 }
    await binding.threads.writePlacement({
      ...binding,
      threadId: args.threadId,
      record,
      expectedRevision: args.prior.revision,
    })
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
      } catch {}
    }
  }
}
