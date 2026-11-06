import {
  EStreamErrorCode,
  EStreamSubscribeKind,
  STREAM_MAX_SESSION_SUBSCRIPTIONS,
} from '@dltech/atlas-protocol'

import { FOLLOW_MAX_SUBSCRIBES_PER_WINDOW, FOLLOW_SUBSCRIBE_WINDOW_MS } from './follow-limits'
import { FollowSubscription } from './follow-subscription'
import type { FollowConnection, FollowDeps, SubscriptionIndex } from './follow-types'
import type { SessionsListIndex } from './sessions-list'
import { SessionsSubscription } from './sessions-subscription'
import type { StreamSubscriptionMessage, SubscriptionSession } from './subscription-port'

export class FollowSession implements SubscriptionSession {
  private readonly subscriptions = new Map<string, FollowSubscription | SessionsSubscription>()
  private recentSubscribes: number[] = []
  private readonly connection: FollowConnection
  private readonly deps: FollowDeps
  private readonly index: SubscriptionIndex
  private readonly sessions: SessionsListIndex

  constructor(args: {
    connection: FollowConnection
    deps: FollowDeps
    index: SubscriptionIndex
    sessions: SessionsListIndex
  }) {
    this.connection = args.connection
    this.deps = args.deps
    this.index = args.index
    this.sessions = args.sessions
  }

  handle(message: StreamSubscriptionMessage): void | Promise<void> {
    if (message.type === 'resnap') {
      const subscription = this.subscriptions.get(message.id)
      if (subscription instanceof SessionsSubscription) return subscription.resnap()
      if (subscription !== undefined) this.index.resnap(subscription)
      return
    }
    if (message.type === 'unsubscribe') {
      this.subscriptions.get(message.id)?.stop()
      return
    }
    if (this.subscriptions.has(message.id)) {
      this.refuse({ id: message.id, code: EStreamErrorCode.BadFrame })
      return
    }
    if (
      this.subscriptions.size >= STREAM_MAX_SESSION_SUBSCRIPTIONS ||
      this.subscribeRateExceeded()
    ) {
      this.refuse({ id: message.id, code: EStreamErrorCode.ForbiddenLimit })
      return
    }
    if (message.kind === EStreamSubscribeKind.Sessions) {
      const listing = new SessionsSubscription({
        id: message.id,
        projectId: message.projectId,
        connection: this.connection,
        index: this.sessions,
        onEnded: (ended) => {
          if (this.subscriptions.get(ended.id) === ended) this.subscriptions.delete(ended.id)
        },
      })
      this.subscriptions.set(message.id, listing)
      return listing.begin()
    }
    const subscription = new FollowSubscription({
      id: message.id,
      sessionId: message.sessionId,
      request: { afterSeq: message.afterSeq, afterHash: message.afterHash },
      connection: this.connection,
      deps: this.deps,
      index: this.index,
      onEnded: (ended) => {
        if (this.subscriptions.get(ended.id) === ended) this.subscriptions.delete(ended.id)
      },
    })
    this.subscriptions.set(message.id, subscription)
    return subscription.begin()
  }

  drain(): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (subscription instanceof FollowSubscription) subscription.handleDrain()
    }
  }

  close(): void {
    for (const subscription of [...this.subscriptions.values()]) subscription.stop()
    this.subscriptions.clear()
  }

  private refuse(args: { id: string; code: EStreamErrorCode }): void {
    this.connection.send({ type: 'error', id: args.id, code: args.code })
  }

  private subscribeRateExceeded(): boolean {
    const now = this.deps.timers.now()
    this.recentSubscribes = this.recentSubscribes.filter(
      (at) => now - at < FOLLOW_SUBSCRIBE_WINDOW_MS,
    )
    if (this.recentSubscribes.length >= FOLLOW_MAX_SUBSCRIBES_PER_WINDOW) return true
    this.recentSubscribes.push(now)
    return false
  }
}
