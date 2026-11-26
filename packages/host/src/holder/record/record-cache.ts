import {
  EMPTY_VISIBILITY,
  RECORD_ONLY_TYPES,
  blobRefsOf,
  blobValueOf,
  chainHash,
  isVisible,
  pendingInputsOf,
  queuedSinceOf,
  resolveBody,
  stepVisibility,
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

import { RecordBlobs } from './record-blobs'
import { RecordBookkeeping } from './record-bookkeeping'
import { RecordLoopEvents } from './record-loop'
import { readPagesOf } from './record-pages'
import type { RecordResumeCache } from './record-resume'
import { firstIndexAfter, itemAtSeq } from './seq-index'

const BLOB_FETCH_CONCURRENCY = 8

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

const eventBytes = (event: RecordEvent): number => JSON.stringify(event).length

const eventsBytes = (events: readonly RecordEvent[]): number =>
  events.reduce((total, event) => total + eventBytes(event), 0)

export class RecordCache {
  private events: RecordEvent[] = []
  private visibility: VisibilityState = EMPTY_VISIBILITY
  private book = new RecordBookkeeping()
  private readonly loops = new RecordLoopEvents()
  private revealed = false
  private diverged = false
  private visibleCache: RecordEvent[] | undefined = undefined
  private blobs = new RecordBlobs()
  private fetchedBytes = 0
  private retained: number | undefined = undefined
  private head: LogHead = { seq: 0, hash: '' as LogHead['hash'] }

  constructor(private readonly args: { plane: ControlPlane; threadId: ThreadId }) {}

  static async load(args: {
    plane: ControlPlane
    threadId: ThreadId
    log?: LogPort | undefined
    resume?: RecordResumeCache | undefined
  }): Promise<RecordCache> {
    const held = args.resume?.take(args.threadId)
    const heldBytes = held?.fetchedBytes ?? 0
    const resumed = held?.resumable() ? held.detach() : undefined
    const cache =
      resumed !== undefined && (await resumed.resume()) ? resumed : new RecordCache(args)
    if (cache !== resumed) await cache.fill()
    args.resume?.keep(cache)
    const fetched = cache.fetchedBytes - (cache === resumed ? heldBytes : 0)
    if (fetched > 0) {
      args.log?.info({
        source: 'holder.record',
        message: 'resolved blob values into the record cache',
        data: { blobs: cache.blobs.size(), bytes: fetched },
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

  private readPages(args: {
    afterSeq: number
    visible: boolean
    hiddenTypes?: readonly RecordEventType[] | undefined
  }): Promise<RecordEvent[]> {
    return readPagesOf({
      plane: this.args.plane,
      threadId: this.args.threadId,
      afterSeq: args.afterSeq,
      visible: args.visible,
      ...(args.hiddenTypes === undefined ? {} : { hiddenTypes: args.hiddenTypes }),
      onPage: (events) => this.resolveBlobsOf(events),
    })
  }

  private async resume(): Promise<boolean> {
    if (!this.resumable() || !this.chainIntact()) return false
    const head = await this.args.plane.head({ threadId: this.args.threadId })
    if (head.seq < this.head.seq) return false
    if (head.seq === this.head.seq) return head.hash === this.head.hash
    const events = await this.readPages({ afterSeq: this.head.seq, visible: false })
    const verified = verifySuffix({ trusted: this.head, events })
    if (!verified.ok || verified.head.seq < head.seq) return false
    if (!events.every((event) => this.resumableEvent(event))) return false
    this.extend({ events, head: verified.head })
    return true
  }

  private chainIntact(): boolean {
    const last = this.events[this.events.length - 1]
    if (last === undefined) return false
    return last.seq === this.head.seq && chainHash(last) === this.head.hash
  }

  private resumableEvent(event: RecordEvent): boolean {
    if (editsHistory(event)) return false
    return isVisible(this.visibility, event) || HOLDER_STATE_TYPES.includes(event.type)
  }

  private rebuild(events: RecordEvent[]): void {
    this.events = events
    this.visibility = events.reduce(stepVisibility, EMPTY_VISIBILITY)
    this.revealed = false
    this.diverged = false
    this.retained = undefined
    this.blobs.prune(events)
    this.book = new RecordBookkeeping()
    this.loops.reset()
    this.visibleCache = undefined
    for (const event of events) {
      const resolved = this.resolvedEvent(event)
      this.book.step(resolved)
      if (isVisible(this.visibility, event)) this.loops.add({ event, resolved })
    }
  }

  async refillIfRevealed(): Promise<void> {
    if (this.revealed) await this.fill()
  }

  async resolveBlobsOf(events: readonly RecordEvent[]): Promise<void> {
    const missing = new Set<string>()
    for (const event of events) {
      for (const ref of blobRefsOf(event)) {
        if (!this.blobs.has(ref.hash)) missing.add(ref.hash)
      }
    }
    const hashes = [...missing]
    for (let start = 0; start < hashes.length; start += BLOB_FETCH_CONCURRENCY) {
      const slice = hashes.slice(start, start + BLOB_FETCH_CONCURRENCY)
      const fetched = await Promise.all(slice.map((hash) => this.args.plane.readBlob({ hash })))
      for (const [index, blob] of fetched.entries()) {
        const hash = slice[index] as string
        if (blob === undefined) throw new Error(`the record store lost blob ${hash}`)
        this.blobs.retain({ hash, value: blobValueOf(blob.bytes), bytes: blob.bytes.byteLength })
        this.fetchedBytes += blob.bytes.byteLength
      }
    }
    this.retained = undefined
  }

  resolvedBlobBytes(): number {
    return this.blobs.retainedBytes()
  }

  retainedBytes(): number {
    this.retained ??= this.resolvedBlobBytes() + eventsBytes(this.events)
    return this.retained
  }

  resumable(): boolean {
    return !this.diverged
  }

  detach(): RecordCache {
    const copy = new RecordCache(this.args)
    copy.blobs = this.blobs.copy()
    copy.fetchedBytes = this.fetchedBytes
    copy.head = this.head
    copy.rebuild([...this.events])
    copy.diverged = this.diverged
    return copy
  }

  resolvedEvent(event: RecordEvent): RecordEvent {
    if (blobRefsOf(event).length === 0) return event
    return resolveBody({ body: event, values: this.blobs.valuesOf() })
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
    return this.loops.handOut()
  }

  threadId(): ThreadId {
    return this.args.threadId
  }

  loopState(): LoopState {
    return this.loops.state()
  }

  queuedSince(): string | null {
    return queuedSinceOf(pendingInputsOf(this.events))
  }

  loopEventsAfter(seq: number): Event[] {
    return this.loops.after(seq)
  }

  extend(args: {
    events: readonly RecordEvent[]
    head: LogHead
    resolved?: ReadonlyMap<string, unknown> | undefined
  }): void {
    for (const [hash, value] of args.resolved ?? []) this.blobs.retainLocal({ hash, value })
    for (const event of this.afterCached(args.events)) {
      if (revealsHidden({ state: this.visibility, event })) {
        this.revealed = true
        this.diverged = true
      }
      this.visibility = stepVisibility(this.visibility, event)
      this.events.push(event)
      const resolved = this.resolvedEvent(event)
      this.book.step(resolved)
      if (editsHistory(event)) {
        this.loops.dropHidden(this.visibility)
        this.diverged = true
      }
      if (isVisible(this.visibility, event)) this.loops.add({ event, resolved })
    }
    if (args.head.seq >= this.head.seq) this.head = args.head
    this.visibleCache = undefined
    this.retained = undefined
  }

  private afterCached(events: readonly RecordEvent[]): readonly RecordEvent[] {
    const last = this.events[this.events.length - 1]
    const lastSeq = last?.seq ?? 0
    const first = events[0]
    if (first === undefined || first.seq > lastSeq) return events
    return events.filter((event) => event.seq > lastSeq)
  }

  replaceHead(head: LogHead): void {
    this.head = head
  }

  committedHashAtSeq(seq: number): string | undefined {
    const event = itemAtSeq({ items: this.events, seq })
    return event === undefined ? undefined : chainHash(event)
  }
}
