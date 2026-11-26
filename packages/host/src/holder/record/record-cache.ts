import {
  EMPTY_VISIBILITY,
  RECORD_ONLY_TYPES,
  blobRefsOf,
  blobValueOf,
  chainHash,
  initialLoopState,
  isVisible,
  loopStateOf,
  pendingInputsOf,
  queuedSinceOf,
  stepLoopState,
  resolveBody,
  stepVisibility,
  toLoopEvent,
  verifySuffix,
  type Event,
  type LogHead,
  type LoopState,
  type ThreadId,
  type RecordEvent,
  type RecordEventType,
  type VisibilityState,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import { RecordBookkeeping } from './record-bookkeeping'
import type { RecordResumeCache } from './record-resume'
import { firstIndexAfter, itemAtSeq } from './seq-index'

const BLOB_FETCH_CONCURRENCY = 8
const READ_PAGE = 1000

export const HOLDER_STATE_TYPES: readonly RecordEventType[] = [
  ...RECORD_ONLY_TYPES,
  'tool-dispatched',
  'user-said',
  'agent-spawned',
]

const revealsHidden = (args: { state: VisibilityState; event: RecordEvent }): boolean => {
  const { event } = args
  if (event.type !== 'history-rewound') return false
  return args.state.spans.some((span) => span.createdAt > event.toSeq)
}

const editsHistory = (event: RecordEvent): boolean =>
  event.type === 'history-rewound' || event.type === 'history-summarised'

export class RecordCache {
  private events: RecordEvent[] = []
  private visibility: VisibilityState = EMPTY_VISIBILITY
  private book = new RecordBookkeeping()
  private loopSources: RecordEvent[] = []
  private loopEvents: Event[] = []
  private loopEventsHandedOut = false
  private state: LoopState = initialLoopState()
  private revealed = false
  private visibleCache: RecordEvent[] | undefined = undefined
  private readonly blobValues = new Map<string, unknown>()
  private fetchedBlobBytes = 0
  private head: LogHead = { seq: 0, hash: '' as LogHead['hash'] }

  constructor(private readonly args: { plane: ControlPlane; threadId: ThreadId }) {}

  static async load(args: {
    plane: ControlPlane
    threadId: ThreadId
    log?: LogPort | undefined
    resume?: RecordResumeCache | undefined
  }): Promise<RecordCache> {
    const held = args.resume?.take(args.threadId)
    const heldBytes = held?.fetchedBlobBytes ?? 0
    const cache = held !== undefined && (await held.resume()) ? held : new RecordCache(args)
    if (cache !== held) await cache.fill()
    args.resume?.keep(cache)
    const fetched = cache.fetchedBlobBytes - (cache === held ? heldBytes : 0)
    if (fetched > 0) {
      args.log?.info({
        source: 'holder.record',
        message: 'resolved blob values into the record cache',
        data: { blobs: cache.blobValues.size, bytes: fetched },
      })
    }
    return cache
  }

  private async fill(): Promise<void> {
    const head = await this.args.plane.head({ threadId: this.args.threadId })
    const events = await this.readPages({
      afterSeq: 0,
      visible: true,
      hiddenTypes: HOLDER_STATE_TYPES,
    })
    this.rebuild(events)
    if (head.seq >= this.head.seq) this.head = head
  }

  private async readPages(args: {
    afterSeq: number
    visible: boolean
    hiddenTypes?: readonly RecordEventType[] | undefined
  }): Promise<RecordEvent[]> {
    const events: RecordEvent[] = []
    let afterSeq = args.afterSeq
    for (;;) {
      const page = await this.args.plane.readEvents({
        threadId: this.args.threadId,
        afterSeq,
        limit: READ_PAGE,
        visible: args.visible,
        ...(args.hiddenTypes === undefined ? {} : { hiddenTypes: args.hiddenTypes }),
      })
      events.push(...page.events)
      await this.resolveBlobsOf(page.events)
      if (page.next === undefined) return events
      afterSeq = page.next
    }
  }

  private async resume(): Promise<boolean> {
    if (!this.chainIntact()) return false
    const head = await this.args.plane.head({ threadId: this.args.threadId })
    if (head.seq < this.head.seq) return false
    if (head.seq === this.head.seq) return head.hash === this.head.hash
    const events = await this.readPages({ afterSeq: this.head.seq, visible: false })
    const verified = verifySuffix({ trusted: this.head, events })
    if (!verified.ok || verified.head.seq < head.seq) return false
    if (!events.every((event) => this.resumable(event))) return false
    this.extend({ events, head: verified.head })
    return true
  }

  private chainIntact(): boolean {
    const last = this.events[this.events.length - 1]
    if (last === undefined) return false
    return last.seq === this.head.seq && chainHash(last) === this.head.hash
  }

  private resumable(event: RecordEvent): boolean {
    if (editsHistory(event)) return false
    return isVisible(this.visibility, event) || HOLDER_STATE_TYPES.includes(event.type)
  }

  private rebuild(events: RecordEvent[]): void {
    this.events = events
    this.visibility = events.reduce(stepVisibility, EMPTY_VISIBILITY)
    this.revealed = false
    this.book = new RecordBookkeeping()
    this.loopSources = []
    this.loopEvents = []
    this.loopEventsHandedOut = false
    this.visibleCache = undefined
    this.state = initialLoopState()
    for (const event of events) {
      this.book.step(this.resolvedEvent(event))
      if (isVisible(this.visibility, event)) this.addLoopEvent(event)
    }
  }

  async refillIfRevealed(): Promise<void> {
    if (this.revealed) await this.fill()
  }

  async resolveBlobsOf(events: readonly RecordEvent[]): Promise<void> {
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

  resolvedEvent(event: RecordEvent): RecordEvent {
    if (blobRefsOf(event).length === 0) return event
    return resolveBody({ body: event, values: this.blobValues })
  }

  currentHead(): LogHead {
    return this.head
  }

  bookkeeping(): RecordBookkeeping {
    return this.book
  }

  eventsAfter(seq: number): RecordEvent[] {
    return this.events.slice(firstIndexAfter({ items: this.events, seq }))
  }

  visibleEvents(): readonly RecordEvent[] {
    this.visibleCache ??= this.events.filter((event) => isVisible(this.visibility, event))
    return this.visibleCache
  }

  visibleLoopEvents(): Event[] {
    this.loopEventsHandedOut = true
    return this.loopEvents
  }

  threadId(): ThreadId {
    return this.args.threadId
  }

  loopState(): LoopState {
    return this.state
  }

  queuedSince(): string | null {
    return queuedSinceOf(pendingInputsOf(this.events))
  }

  loopEventsAfter(seq: number): Event[] {
    return this.loopEvents.slice(firstIndexAfter({ items: this.loopEvents, seq }))
  }

  extend(args: {
    events: readonly RecordEvent[]
    head: LogHead
    resolved?: ReadonlyMap<string, unknown> | undefined
  }): void {
    for (const [hash, value] of args.resolved ?? []) this.blobValues.set(hash, value)
    for (const event of this.afterCached(args.events)) {
      if (revealsHidden({ state: this.visibility, event })) this.revealed = true
      this.visibility = stepVisibility(this.visibility, event)
      this.events.push(event)
      this.book.step(this.resolvedEvent(event))
      if (editsHistory(event)) this.dropHiddenLoopEvents()
      if (isVisible(this.visibility, event)) this.addLoopEvent(event)
    }
    if (args.head.seq >= this.head.seq) this.head = args.head
    this.visibleCache = undefined
  }

  private afterCached(events: readonly RecordEvent[]): readonly RecordEvent[] {
    const last = this.events[this.events.length - 1]
    const lastSeq = last?.seq ?? 0
    const first = events[0]
    if (first === undefined || first.seq > lastSeq) return events
    return events.filter((event) => event.seq > lastSeq)
  }

  private addLoopEvent(event: RecordEvent): void {
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
    const sources: RecordEvent[] = []
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
