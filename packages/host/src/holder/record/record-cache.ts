import {
  chainHash,
  visibleEvents,
  type LogHead,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import { toLoopEvent } from './event-strip'

export class RecordCache {
  private readonly events: V2Event[] = []
  private head: LogHead = { seq: 0, hash: '' as LogHead['hash'] }

  constructor(private readonly args: { plane: ControlPlane; threadId: ThreadId }) {}

  static async load(args: { plane: ControlPlane; threadId: ThreadId }): Promise<RecordCache> {
    const cache = new RecordCache(args)
    cache.head = await args.plane.head({ threadId: args.threadId })
    let afterSeq = 0
    for (;;) {
      const page = await args.plane.readEvents({
        threadId: args.threadId,
        afterSeq,
        limit: 1000,
        visible: false,
      })
      cache.events.push(...page.events)
      if (page.next === undefined) return cache
      afterSeq = page.next
    }
  }

  currentHead(): LogHead {
    return this.head
  }

  all(): readonly V2Event[] {
    return this.events
  }

  visibleLoopEvents() {
    return visibleEvents(this.events).flatMap((event) => {
      const loop = toLoopEvent(event)
      return loop === undefined ? [] : [loop]
    })
  }

  loopEvents() {
    return this.events.flatMap((event) => {
      const loop = toLoopEvent(event)
      return loop === undefined ? [] : [loop]
    })
  }

  extend(args: { events: readonly V2Event[]; head: LogHead }): void {
    this.events.push(...args.events)
    this.head = args.head
  }

  replaceHead(head: LogHead): void {
    this.head = head
  }

  committedHashAtSeq(seq: number): string | undefined {
    const event = this.events.find((candidate) => candidate.seq === seq)
    return event === undefined ? undefined : chainHash(event)
  }

  findDispatched(callId: string): { bootId?: string | undefined } | undefined {
    const hit = this.events.findLast(
      (event) => event.type === 'tool-dispatched' && event.callId === callId,
    )
    if (hit === undefined || hit.type !== 'tool-dispatched') return undefined
    return { bootId: hit.bootId }
  }
}
