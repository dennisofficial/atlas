import { EStreamErrorCode } from '@dltech/atlas-protocol'

import type { SessionEntry } from './session-entry'
import type { SessionsListIndex } from './sessions-list'
import type { SubscriptionConnection } from './subscription-port'

export type SessionsSubscriptionArgs = {
  id: string
  projectId: string | undefined
  connection: SubscriptionConnection
  index: SessionsListIndex
  onEnded(subscription: SessionsSubscription): void
}

export class SessionsSubscription {
  readonly id: string
  readonly projectId: string | undefined
  private readonly sent = new Map<string, string>()
  private readonly deferred = new Set<string>()
  private stopped = false
  private snapshotting = false
  private resnapRequested = false

  constructor(private readonly args: SessionsSubscriptionArgs) {
    this.id = args.id
    this.projectId = args.projectId
  }

  get userId(): string {
    return this.args.connection.userId
  }

  begin(): Promise<void> {
    this.args.index.add(this)
    return this.resnap()
  }

  matches(projectId: string): boolean {
    return this.projectId === undefined || this.projectId === projectId
  }

  async resnap(): Promise<void> {
    if (this.stopped) return
    if (this.snapshotting) {
      this.resnapRequested = true
      return
    }
    this.snapshotting = true
    try {
      do {
        this.resnapRequested = false
        const rows = await this.args.index.readSnapshot(this)
        if (this.stopped) return
        this.sent.clear()
        for (const row of rows) this.sent.set(row.sessionId, JSON.stringify(row))
        this.args.connection.send({ type: 'snapshot', id: this.id, rows })
      } while (this.resnapRequested)
    } catch (error) {
      this.args.index.fail({ error, targets: [this] })
      return
    } finally {
      this.snapshotting = false
    }
    this.flushDeferred()
  }

  apply(entry: SessionEntry): void {
    if (this.stopped) return
    const { row } = entry
    if (this.snapshotting) {
      this.deferred.add(row.sessionId)
      return
    }
    const json = JSON.stringify(row)
    if (this.sent.get(row.sessionId) === json) return
    this.sent.set(row.sessionId, json)
    this.args.connection.send({ type: 'upsert', id: this.id, row })
  }

  absent(sessionId: string): void {
    if (this.stopped) return
    if (this.snapshotting) {
      this.deferred.add(sessionId)
      return
    }
    if (!this.sent.delete(sessionId)) return
    this.args.connection.send({ type: 'remove', id: this.id, sessionId })
  }

  fail(): void {
    if (this.stopped) return
    this.args.connection.send({ type: 'error', id: this.id, code: EStreamErrorCode.Internal })
    this.stop()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.sent.clear()
    this.deferred.clear()
    this.args.index.remove(this)
    this.args.onEnded(this)
  }

  private flushDeferred(): void {
    const sessionIds = [...this.deferred]
    this.deferred.clear()
    for (const sessionId of sessionIds) void this.args.index.refresh(sessionId)
  }
}
