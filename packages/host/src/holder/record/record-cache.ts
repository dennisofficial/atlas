import {
  EMPTY_VISIBILITY,
  RECORD_ONLY_TYPES,
  blobRefsOf,
  blobValueOf,
  chainHash,
  initialLoopState,
  isVisible,
  loopStateOf,
  stepLoopState,
  resolveBody,
  stepVisibility,
  toLoopEvent,
  type Event,
  type LogHead,
  type LoopState,
  type ThreadId,
  type V2Event,
  type V2EventType,
  type VisibilityState,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import { RecordBookkeeping } from './record-bookkeeping'
import { firstIndexAfter, itemAtSeq } from './seq-index'

const BLOB_FETCH_CONCURRENCY = 8

export const HOLDER_STATE_TYPES: readonly V2EventType[] = [
  ...RECORD_ONLY_TYPES,
  'tool-dispatched',
  'user-said',
  'agent-spawned',
]

const revealsHidden = (args: { state: VisibilityState; event: V2Event }): boolean => {
  const { event } = args
  if (event.type !== 'history-rewound') return false
  return args.state.spans.some((span) => span.createdAt > event.toSeq)
}

const editsHistory = (event: V2Event): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

export class RecordCache {
  private events: V2Event[] = []
  private visibility: VisibilityState = EMPTY_VISIBILITY
  private book = new RecordBookkeeping()
  private loopSources: V2Event[] = []
  private loopEvents: Event[] = []
  private loopEventsHandedOut = false
  private state: LoopState = initialLoopState()
  private revealed = false
  private readonly blobValues = new Map<string, unknown>()
  private fetchedBlobBytes = 0
  private head: LogHead = { seq: 0, hash: '' as LogHead['hash'] }

  constructor(private readonly args: { plane: ControlPlane; threadId: ThreadId }) {}

  static async load(args: {
    plane: ControlPlane
    threadId: ThreadId
    log?: LogPort | undefined
  }): Promise<RecordCache> {
    const cache = new RecordCache(args)
    await cache.fill()
    if (cache.fetchedBlobBytes > 0) {
      args.log?.info({
        source: 'holder.record',
        message: 'resolved blob values into the record cache',
        data: { blobs: cache.blobValues.size, bytes: cache.fetchedBlobBytes },
      })
    }
    return cache
  }

  private async fill(): Promise<void> {
    const events: V2Event[] = []
    const head = await this.args.plane.head({ threadId: this.args.threadId })
    let afterSeq = 0
    for (;;) {
      const page = await this.args.plane.readEvents({
        threadId: this.args.threadId,
        afterSeq,
        limit: 1000,
        visible: true,
        hiddenTypes: HOLDER_STATE_TYPES,
      })
      events.push(...page.events)
      await this.resolveBlobsOf(page.events)
      if (page.next === undefined) break
      afterSeq = page.next
    }
    this.rebuild(events)
    if (head.seq >= this.head.seq) this.head = head
  }

  private rebuild(events: V2Event[]): void {
    this.events = events
    this.visibility = events.reduce(stepVisibility, EMPTY_VISIBILITY)
    this.revealed = false
    this.book = new RecordBookkeeping()
    this.loopSources = []
    this.loopEvents = []
    this.loopEventsHandedOut = false
    this.state = initialLoopState()
    for (const event of events) {
      this.book.step(this.resolvedEvent(event))
      if (isVisible(this.visibility, event)) this.addLoopEvent(event)
    }
  }

  async refillIfRevealed(): Promise<void> {
    if (this.revealed) await this.fill()
  }

  async resolveBlobsOf(events: readonly V2Event[]): Promise<void> {
    const missing = new Set<string>()
    for (const event of events) {
      for (const ref of blobRefsOf(event)) {
        if (!this.blobValues.has(ref.hash)) missing.add(ref.hash)
      }
    }
    const hashes = [...missing]
    for (let start = 0; start < hashes.length; start += BLOB_FETCH_CONCURRENCY) {
      const slice = hashes.slice(start, start + BLOB_FETCH_CONCURRENCY)
      const fetched = await Promise.all(slice.map((hash) => this.args.plane.readBlob({ hash })))
      for (const [index, blob] of fetched.entries()) {
        const hash = slice[index] as string
        if (blob === undefined) throw new Error(`the record store lost blob ${hash}`)
        this.blobValues.set(hash, blobValueOf(blob.bytes))
        this.fetchedBlobBytes += blob.bytes.byteLength
      }
    }
  }

  resolvedBlobBytes(): number {
    return this.fetchedBlobBytes
  }

  resolvedEvent(event: V2Event): V2Event {
    if (blobRefsOf(event).length === 0) return event
    return resolveBody({ body: event, values: this.blobValues })
  }

  currentHead(): LogHead {
    return this.head
  }

  bookkeeping(): RecordBookkeeping {
    return this.book
  }

  eventsAfter(seq: number): V2Event[] {
    return this.events.slice(firstIndexAfter({ items: this.events, seq }))
  }

  visibleLoopEvents(): Event[] {
    this.loopEventsHandedOut = true
    return this.loopEvents
  }

  loopState(): LoopState {
    return this.state
  }

  loopEventsAfter(seq: number): Event[] {
    return this.loopEvents.slice(firstIndexAfter({ items: this.loopEvents, seq }))
  }

  extend(args: {
    events: readonly V2Event[]
    head: LogHead
    resolved?: ReadonlyMap<string, unknown> | undefined
  }): void {
    for (const [hash, value] of args.resolved ?? []) this.blobValues.set(hash, value)
    for (const event of args.events) {
      if (revealsHidden({ state: this.visibility, event })) this.revealed = true
      this.visibility = stepVisibility(this.visibility, event)
      this.events.push(event)
      this.book.step(this.resolvedEvent(event))
      if (editsHistory(event)) this.dropHiddenLoopEvents()
      if (isVisible(this.visibility, event)) this.addLoopEvent(event)
    }
    this.head = args.head
  }

  private addLoopEvent(event: V2Event): void {
    const loop = toLoopEvent({ event: this.resolvedEvent(event) })
    if (loop === undefined) return
    if (this.loopEventsHandedOut) {
      this.loopEvents = this.loopEvents.slice()
      this.loopEventsHandedOut = false
    }
    this.loopSources.push(event)
    this.loopEvents.push(loop)
    this.state = stepLoopState(this.state, loop)
  }

  private dropHiddenLoopEvents(): void {
    const sources: V2Event[] = []
    const loops: Event[] = []
    for (const [index, source] of this.loopSources.entries()) {
      const loop = this.loopEvents[index]
      if (loop === undefined || !isVisible(this.visibility, source)) continue
      sources.push(source)
      loops.push(loop)
    }
    this.loopSources = sources
    this.loopEvents = loops
    this.loopEventsHandedOut = false
    this.state = loopStateOf({ events: loops })
  }

  replaceHead(head: LogHead): void {
    this.head = head
  }

  committedHashAtSeq(seq: number): string | undefined {
    const event = itemAtSeq({ items: this.events, seq })
    return event === undefined ? undefined : chainHash(event)
  }
}
