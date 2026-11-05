import {
  EStreamErrorCode,
  EStreamSubscribeKind,
  STREAM_MAX_SESSION_SUBSCRIPTIONS,
} from '@dltech/atlas-protocol'

import { FOLLOW_MAX_SUBSCRIBES_PER_WINDOW, FOLLOW_SUBSCRIBE_WINDOW_MS } from './follow-limits'
import { FollowSubscription } from './follow-subscription'
import type { FollowConnection, FollowDeps, SubscriptionIndex } from './follow-types'
import type { StreamSubscriptionMessage, SubscriptionSession } from './subscription-port'

export class FollowSession implements SubscriptionSession {
  private readonly subscriptions = new Map<string, FollowSubscription>()
  private recentSubscribes: number[] = []

  constructor(
    private readonly connection: FollowConnection,
    private readonly deps: FollowDeps,
    private readonly index: SubscriptionIndex,
  ) {}

  handle(message: StreamSubscriptionMessage): void | Promise<void> {
    if (message.type === 'resnap') return
    if (message.type === 'unsubscribe') {
      this.subscriptions.get(message.id)?.stop()
      return
    }
    if (message.kind === EStreamSubscribeKind.Sessions) {
      this.refuse({ id: message.id, code: EStreamErrorCode.Internal })
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
