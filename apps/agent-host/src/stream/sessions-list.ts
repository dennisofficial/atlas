import { logFieldsOf } from '@dltech/atlas-observability'
import type { SessionChange, SessionSummary } from '@dltech/atlas-protocol'

import { entryOf, type SessionEntry } from './session-entry'
import type { FollowDeps } from './follow-types'
import type { SessionsSubscription } from './sessions-subscription'

const SNAPSHOT_LIMIT = 100
const OWNER_CACHE_MAX = 10_000

type Owner = { userId: string; projectId: string }
type Deadline = { userId: string; handle: unknown }

export class SessionsListIndex {
  private readonly subscriptions = new Set<SessionsSubscription>()
  private readonly owners = new Map<string, Owner>()
  private readonly inflight = new Map<string, { dirty: boolean }>()
  private readonly deadlines = new Map<string, Deadline>()

  constructor(private readonly deps: FollowDeps) {}

  add(subscription: SessionsSubscription): void {
    this.subscriptions.add(subscription)
  }

  remove(subscription: SessionsSubscription): void {
    this.subscriptions.delete(subscription)
    const { userId } = subscription
    if ([...this.subscriptions].some((other) => other.userId === userId)) return
    for (const [sessionId, deadline] of [...this.deadlines]) {
      if (deadline.userId === userId) this.clearDeadline(sessionId)
    }
  }

  async readSnapshot(subscription: SessionsSubscription): Promise<SessionSummary[]> {
    const digests = await this.deps.plane.listSessionDigests({
      userId: subscription.userId,
      projectId: subscription.projectId,
      limit: SNAPSHOT_LIMIT,
    })
    const now = this.deps.timers.now()
    return digests.map((digest) => {
      const entry = entryOf({ digest, now })
      this.remember({ sessionId: digest.sessionId, entry })
      return entry.row
    })
  }

  handleChange(change: SessionChange): void {
    if (this.subscriptions.size === 0) return
    void this.refresh(change.sessionId)
  }

  handleGap(): void {
    for (const subscription of [...this.subscriptions]) void subscription.resnap()
  }

  async refresh(sessionId: string): Promise<void> {
    if (this.subscriptions.size === 0) return
    const running = this.inflight.get(sessionId)
    if (running !== undefined) {
      running.dirty = true
      return
    }
    const state = { dirty: false }
    this.inflight.set(sessionId, state)
    let affected = [...this.subscriptions]
    try {
      do {
        state.dirty = false
        const owner = await this.ownerOf(sessionId)
        if (owner === undefined) return
        affected = this.targetsOf(owner)
        if (affected.length > 0) await this.recompute({ sessionId, owner, targets: affected })
      } while (state.dirty)
    } catch (error) {
      this.fail({ error, targets: affected })
    } finally {
      this.inflight.delete(sessionId)
    }
  }

  fail(args: { error: unknown; targets: readonly SessionsSubscription[] }): void {
    this.deps.log?.error({
      source: 'stream',
      message: 'sessions subscription failed',
      ...logFieldsOf({ error: args.error }),
    })
    for (const target of [...args.targets]) target.fail()
  }

  close(): void {
    for (const sessionId of [...this.deadlines.keys()]) this.clearDeadline(sessionId)
    this.subscriptions.clear()
    this.owners.clear()
  }

  private async recompute(args: {
    sessionId: string
    owner: Owner
    targets: readonly SessionsSubscription[]
  }): Promise<void> {
    const [digest] = await this.deps.plane.listSessionDigests({
      userId: args.owner.userId,
      sessionId: args.sessionId,
      limit: 1,
    })
    if (digest === undefined) {
      this.clearDeadline(args.sessionId)
      for (const target of args.targets) target.absent(args.sessionId)
      return
    }
    const entry = entryOf({ digest, now: this.deps.timers.now() })
    this.remember({ sessionId: args.sessionId, entry })
    for (const target of args.targets) target.apply(entry)
  }

  private targetsOf(owner: Owner): SessionsSubscription[] {
    return [...this.subscriptions].filter(
      (subscription) =>
        subscription.userId === owner.userId && subscription.matches(owner.projectId),
    )
  }

  private async ownerOf(sessionId: string): Promise<Owner | undefined> {
    const cached = this.owners.get(sessionId)
    if (cached !== undefined) return cached
    const session = await this.deps.plane.readSession({ sessionId })
    if (session === undefined) return undefined
    const owner = { userId: session.userId, projectId: session.projectId }
    this.cacheOwner({ sessionId, owner })
    return owner
  }

  private remember(args: { sessionId: string; entry: SessionEntry }): void {
    const { entry, sessionId } = args
    this.cacheOwner({ sessionId, owner: { userId: entry.userId, projectId: entry.projectId } })
    this.clearDeadline(sessionId)
    if (entry.namingEndsAt === undefined) return
    const delay = Math.max(0, entry.namingEndsAt - this.deps.timers.now())
    const handle = this.deps.timers.setTimeout(() => {
      this.deadlines.delete(sessionId)
      void this.refresh(sessionId)
    }, delay)
    this.deadlines.set(sessionId, { userId: entry.userId, handle })
  }

  private cacheOwner(args: { sessionId: string; owner: Owner }): void {
    if (this.owners.size >= OWNER_CACHE_MAX && !this.owners.has(args.sessionId)) {
      const oldest = this.owners.keys().next().value
      if (oldest !== undefined) this.owners.delete(oldest)
    }
    this.owners.set(args.sessionId, args.owner)
  }

  private clearDeadline(sessionId: string): void {
    const deadline = this.deadlines.get(sessionId)
    if (deadline === undefined) return
    this.deps.timers.clearTimeout(deadline.handle)
    this.deadlines.delete(sessionId)
  }
}
