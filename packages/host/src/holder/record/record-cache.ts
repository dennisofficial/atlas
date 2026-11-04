import {
  blobRefsOf,
  blobValueOf,
  chainHash,
  resolveBody,
  visibleEvents,
  type LogHead,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import { toLoopEvent } from './event-strip'

export class RecordCache {
  private readonly events: V2Event[] = []
  private readonly blobValues = new Map<string, unknown>()
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
      await cache.resolveBlobsOf(page.events)
      if (page.next === undefined) return cache
      afterSeq = page.next
    }
  }

  async resolveBlobsOf(events: readonly V2Event[]): Promise<void> {
    for (const event of events) {
      for (const ref of blobRefsOf(event)) {
        if (this.blobValues.has(ref.hash)) continue
        const blob = await this.args.plane.readBlob({ hash: ref.hash })
        if (blob === undefined) throw new Error(`the record store lost blob ${ref.hash}`)
        this.blobValues.set(ref.hash, blobValueOf(blob.bytes))
      }
    }
  }

  private resolved(event: V2Event): V2Event {
    if (blobRefsOf(event).length === 0) return event
    return resolveBody({ body: event, values: this.blobValues })
  }

  currentHead(): LogHead {
    return this.head
  }

  all(): readonly V2Event[] {
    return this.events
  }

  visibleLoopEvents() {
    return visibleEvents(this.events).flatMap((event) => {
      const loop = toLoopEvent(this.resolved(event))
      return loop === undefined ? [] : [loop]
    })
  }

  loopEvents() {
    return this.events.flatMap((event) => {
      const loop = toLoopEvent(this.resolved(event))
      return loop === undefined ? [] : [loop]
    })
  }

  extend(args: {
    events: readonly V2Event[]
    head: LogHead
    resolved?: ReadonlyMap<string, unknown> | undefined
  }): void {
    this.events.push(...args.events)
    this.head = args.head
    if (args.resolved === undefined) return
    for (const [hash, value] of args.resolved) this.blobValues.set(hash, value)
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
