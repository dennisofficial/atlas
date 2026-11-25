import {
  chainEvents,
  projectedEvents,
  toLoopEvent,
  type Event,
  type LoopState,
  type RunId,
  type ThreadId,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { BlobWrite, ControlPlane } from '@dltech/atlas-control'
import type { AgentRecordPort, ModelContextPort } from '@dltech/atlas-agent'
import type { LogPort } from '@dltech/atlas-observability'

import type { RemoteCalls } from '../../calls/remote-calls'
import type { HostTimers } from '../ports'
import { AppendRetry, type DaemonAck } from './append-retry'
import { LeaseLostError } from './lease-lost-error'
import { RecordCache } from './record-cache'
import { storePictures, type PictureStore } from './record-pictures'
import { spillForAppend } from './record-spill'
import { abortErrorOf, abortedOnHandoff, toRecordBody, type AppendBody } from './append-drafts'
import { RecordCorruptionError } from './append-drafts'
import { ackRecordedDaemonResults, prepareDraft } from './record-commit'

export { LeaseLostError, RecordCorruptionError }
export type { AppendBody }

export const BLOB_SPILL_BYTES = 256 * 1024

const STEP_EVENT_TYPES: ReadonlySet<string> = new Set(['assistant-said', 'tool-called'])

const postedInputAtsOf = (events: readonly RecordEvent[]): ReadonlyMap<number, string> =>
  new Map(
    events.flatMap((event) =>
      event.type === 'input-posted' ? [[event.inboxId, event.postedAt] as const] : [],
    ),
  )

export type AppendArgs = {
  threadId: ThreadId
  runId: RunId
  parentRunId?: RunId | undefined
  depth?: number | undefined
  drafts: readonly AppendBody[]
  signal?: AbortSignal | undefined
}

export type SessionRecordArgs = {
  plane: ControlPlane
  threadId: ThreadId
  epoch: number
  timers: HostTimers
  remoteCalls: RemoteCalls
  daemonTools: ReadonlySet<string>
  pictures?: PictureStore | undefined
  blobSpillBytes?: number | undefined
  preloaded?: RecordCache | undefined
  appendRetryMs?: number | undefined
  onLeaseLost?: ((error: LeaseLostError) => void) | undefined
  onStepAppended?: (() => void) | undefined
  log?: LogPort | undefined
  nowIso(): string
}

export class SessionRecord implements AgentRecordPort, ModelContextPort {
  private readonly cache: RecordCache
  private readonly retry: AppendRetry
  private tail: Promise<void> = Promise.resolve()
  private draining = false
  private fenced = false
  private stepped = false

  constructor(
    private readonly args: SessionRecordArgs,
    cache: RecordCache,
  ) {
    this.cache = cache
    this.retry = new AppendRetry({
      plane: args.plane,
      threadId: args.threadId,
      epoch: args.epoch,
      cache,
      daemonTools: args.daemonTools,
      remoteCalls: args.remoteCalls,
      timers: args.timers,
      ...(args.appendRetryMs === undefined ? {} : { appendRetryMs: args.appendRetryMs }),
      ...(args.log === undefined ? {} : { log: args.log }),
      isFenced: () => this.fenced,
      ...(args.onLeaseLost === undefined ? {} : { onLeaseLost: args.onLeaseLost }),
    })
  }

  static async open(args: SessionRecordArgs): Promise<SessionRecord> {
    const cache =
      args.preloaded ??
      (await RecordCache.load({ plane: args.plane, threadId: args.threadId, log: args.log }))
    void ackRecordedDaemonResults({
      cache,
      daemonTools: args.daemonTools,
      remoteCalls: args.remoteCalls,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    return new SessionRecord(args, cache)
  }

  get threadId(): ThreadId {
    return this.args.threadId
  }

  markDraining(): void {
    this.draining = true
    this.args.remoteCalls.releaseResize()
  }

  fence(): void {
    this.fenced = true
    this.args.remoteCalls.releaseResize()
    this.retry.wake()
  }

  eventCache(): RecordCache {
    return this.cache
  }

  async ownEvents(args: { threadId: ThreadId; afterSeq?: number | undefined }): Promise<Event[]> {
    if (args.afterSeq === undefined) return this.cache.visibleLoopEvents()
    return this.cache.loopEventsAfter(args.afterSeq)
  }

  async composedEvents(_args: { threadId: ThreadId }): Promise<Event[]> {
    return this.cache.visibleLoopEvents()
  }

  async loopState(_args: { threadId: ThreadId }): Promise<LoopState> {
    return this.cache.loopState()
  }

  queuedSince(): string | null {
    return this.cache.queuedSince()
  }

  async postedInputAts(_args: { threadId: ThreadId }): Promise<ReadonlyMap<number, string>> {
    return postedInputAtsOf(this.cache.eventsAfter(0))
  }

  async read(_args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }> {
    return { events: projectedEvents(this.cache.visibleLoopEvents()) }
  }

  append(args: AppendArgs): Promise<Event[]> {
    return this.gatedAppend(args)
  }

  private async gatedAppend(args: AppendArgs): Promise<Event[]> {
    if (!args.drafts.some((draft) => this.isDaemonDispatch(draft))) {
      return (await this.enqueue(args)) ?? []
    }
    for (;;) {
      await this.admit(args.signal)
      const events = await this.enqueue(args)
      if (events !== undefined) return events
    }
  }

  private async admit(signal: AbortSignal | undefined): Promise<void> {
    await this.args.remoteCalls.awaitResize({ signal })
    if (this.fenced) {
      throw new LeaseLostError('the holder self-fenced; no append is attempted', 'self-fenced')
    }
    if (signal?.aborted === true) throw abortErrorOf(signal)
  }

  private enqueue(args: AppendArgs): Promise<Event[] | undefined> {
    const run = this.tail.then(() => this.appendSerial(args))
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private resizeHeld(): boolean {
    return this.args.remoteCalls.resizeHeld() !== undefined
  }

  private isDaemonDispatch(draft: AppendBody): boolean {
    return (
      draft.type === 'tool-dispatched' &&
      draft.detached !== true &&
      this.args.daemonTools.has(draft.name)
    )
  }

  private async appendSerial(args: AppendArgs): Promise<Event[] | undefined> {
    if (this.fenced) {
      throw new LeaseLostError('the holder self-fenced; no append is attempted', 'self-fenced')
    }
    const gated = args.drafts.some((draft) => this.isDaemonDispatch(draft))
    if (gated && this.resizeHeld()) return undefined
    const bodies: RecordEventBody[] = []
    const blobs: BlobWrite[] = []
    const resolved = new Map<string, unknown>()
    const ackDaemons: DaemonAck[] = []
    for (const raw of args.drafts) {
      const draft = await prepareDraft(
        {
          cache: this.cache,
          daemonTools: this.args.daemonTools,
          remoteCalls: this.args.remoteCalls,
        },
        abortedOnHandoff(raw, this.draining),
      )
      if (draft === undefined) continue
      const body = await storePictures({
        body: toRecordBody(draft),
        pictures: this.args.pictures,
        timers: this.args.timers,
        ...(this.args.log === undefined ? {} : { log: this.args.log }),
      })
      const spilled = spillForAppend({
        body,
        thresholdBytes: this.args.blobSpillBytes ?? BLOB_SPILL_BYTES,
        ...(this.args.log === undefined ? {} : { log: this.args.log }),
      })
      bodies.push(spilled.body)
      blobs.push(...spilled.blobs)
      for (const [hash, value] of spilled.resolved) resolved.set(hash, value)
      if (draft.type === 'tool-result') {
        ackDaemons.push({ callId: draft.callId, name: draft.name, runId: args.runId })
      }
    }
    if (bodies.length === 0) return []
    if (gated && this.resizeHeld()) return undefined
    const events = chainEvents({
      threadId: args.threadId,
      runId: args.runId,
      epoch: this.args.epoch,
      bodies,
      from: this.cache.currentHead(),
      at: this.args.nowIso(),
      ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
    })
    await this.retry.commit({
      threadId: args.threadId,
      events,
      blobs,
      resolved,
      ackDaemons,
    })
    const first = events[0]
    if (first === undefined) return []
    const committed: Event[] = []
    for (const event of this.cache.eventsAfter(first.seq - 1)) {
      const loop = toLoopEvent({ event: this.cache.resolvedEvent(event) })
      if (loop !== undefined) committed.push(loop)
    }
    this.noteStep(committed)
    return committed
  }

  private noteStep(committed: readonly Event[]): void {
    if (this.stepped) return
    if (!committed.some((event) => STEP_EVENT_TYPES.has(event.type))) return
    this.stepped = true
    this.args.onStepAppended?.()
  }
}
