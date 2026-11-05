import {
  chainEvents,
  chainHash,
  toLoopEvent,
  type BlobPayload,
  type Event,
  type RunId,
  type ThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { AppendOutcome, ControlPlane } from '@dltech/atlas-control'
import type { AgentRecordPort, ModelContextPort } from '@dltech/atlas-agent'
import type { LogPort } from '@dltech/atlas-observability'

import type { RemoteCalls } from '../../calls/remote-calls'
import type { HostTimers } from '../ports'
import { RecordCache } from './record-cache'
import { spillForAppend } from './record-spill'
import { abortedOnHandoff, inboxIdOf, toRecordBody, type AppendBody } from './append-drafts'
import { RecordCorruptionError } from './append-drafts'
import { ackDaemonScope, ackRecordedDaemonResults, prepareDraft, resyncHead } from './record-commit'

export { RecordCorruptionError }
export type { AppendBody }

export class LeaseLostError extends Error {
  constructor(
    message: string,
    readonly refusal: string,
  ) {
    super(message)
    this.name = 'LeaseLostError'
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const BLOB_SPILL_BYTES = 256 * 1024

export type SessionRecordArgs = {
  plane: ControlPlane
  threadId: ThreadId
  epoch: number
  timers: HostTimers
  remoteCalls: RemoteCalls
  daemonTools: ReadonlySet<string>
  blobSpillBytes?: number | undefined
  preloaded?: RecordCache | undefined
  retryUntil?: (() => number) | undefined
  onLeaseLost?: ((error: LeaseLostError) => void) | undefined
  log?: LogPort | undefined
  nowIso(): string
}

export class SessionRecord implements AgentRecordPort, ModelContextPort {
  private readonly cache: RecordCache
  private tail: Promise<void> = Promise.resolve()
  private draining = false
  private fenced = false
  private wakeSleep: (() => void) | undefined

  constructor(
    private readonly args: SessionRecordArgs,
    cache: RecordCache,
  ) {
    this.cache = cache
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
  }

  fence(): void {
    this.fenced = true
    this.wakeSleep?.()
  }

  eventCache(): RecordCache {
    return this.cache
  }

  async ownEvents(args: { threadId: ThreadId; afterSeq?: number }): Promise<Event[]> {
    const events = this.cache.visibleLoopEvents()
    if (args.afterSeq === undefined) return events
    return events.filter((event) => event.seq > (args.afterSeq ?? 0))
  }

  async composedEvents(_args: { threadId: ThreadId }): Promise<Event[]> {
    return this.cache.visibleLoopEvents()
  }

  async read(_args: { threadId: ThreadId }): Promise<{ events: readonly Event[] }> {
    return { events: this.cache.visibleLoopEvents() }
  }

  append(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly AppendBody[]
  }): Promise<Event[]> {
    const run = this.tail.then(() => this.appendSerial(args))
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async appendSerial(args: {
    threadId: ThreadId
    runId: RunId
    parentRunId?: RunId | undefined
    depth?: number | undefined
    drafts: readonly AppendBody[]
  }): Promise<Event[]> {
    if (this.fenced) {
      throw new LeaseLostError('the holder self-fenced; no append is attempted', 'self-fenced')
    }
    const committed: Event[] = []
    let head = this.cache.currentHead()
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
      const bodies: V2Body[] = []
      const inboxId = inboxIdOf(draft)
      if (inboxId !== undefined) bodies.push({ type: 'input-consumed', inboxId })
      const spilled = spillForAppend({
        body: toRecordBody(draft),
        thresholdBytes: this.args.blobSpillBytes ?? BLOB_SPILL_BYTES,
        ...(this.args.log === undefined ? {} : { log: this.args.log }),
      })
      bodies.push(spilled.body)
      const events = chainEvents({
        threadId: args.threadId,
        runId: args.runId,
        epoch: this.args.epoch,
        bodies,
        from: head,
        at: this.args.nowIso(),
        ...(args.parentRunId === undefined ? {} : { parentRunId: args.parentRunId }),
      })
      const last = events[events.length - 1]
      if (last !== undefined) head = { seq: last.seq, hash: chainHash(last) }
      await this.commitWithRetry({
        threadId: args.threadId,
        events,
        blobs: spilled.blobs,
        resolved: spilled.resolved,
        ...(draft.type === 'tool-result'
          ? { ackDaemon: { callId: draft.callId, name: draft.name, runId: args.runId } }
          : {}),
      })
      for (const event of events) {
        const loop = toLoopEvent({ event: this.cache.resolvedEvent(event), log: this.cache.all() })
        if (loop !== undefined) committed.push(loop)
      }
    }
    return committed
  }

  private async commitWithRetry(args: {
    threadId: ThreadId
    events: V2Event[]
    blobs: readonly BlobPayload[]
    resolved: ReadonlyMap<string, unknown>
    ackDaemon?: { callId: string; name: string; runId: RunId } | undefined
  }): Promise<void> {
    let delayMs = 100
    for (;;) {
      if (this.fenced) {
        throw new LeaseLostError('the holder self-fenced; no append is attempted', 'self-fenced')
      }
      if (this.retryExhausted()) {
        this.lost(new LeaseLostError('the record store never answered in time', 'retry-exhausted'))
      }
      const outcome = await this.tryAppend({
        threadId: args.threadId,
        events: args.events,
        blobs: args.blobs,
        resolved: args.resolved,
      })
      if (outcome === 'committed') {
        if (args.ackDaemon !== undefined) {
          await ackDaemonScope({
            ...args.ackDaemon,
            daemonTools: this.args.daemonTools,
            remoteCalls: this.args.remoteCalls,
            ...(this.args.log === undefined ? {} : { log: this.args.log }),
          })
        }
        return
      }
      await this.sleep(delayMs)
      delayMs = Math.min(delayMs * 2, 2_000)
    }
  }

  private retryExhausted(): boolean {
    const until = this.args.retryUntil
    return until !== undefined && this.args.timers.now() >= until()
  }

  private async tryAppend(args: {
    threadId: ThreadId
    events: V2Event[]
    blobs: readonly BlobPayload[]
    resolved: ReadonlyMap<string, unknown>
  }): Promise<'committed' | 'retry'> {
    let outcome: AppendOutcome
    try {
      outcome = await this.args.plane.append({
        threadId: args.threadId,
        epoch: this.args.epoch,
        events: args.events,
        blobs: args.blobs,
      })
    } catch {
      return 'retry'
    }
    if (outcome.ok) {
      this.cache.extend({ events: args.events, head: outcome.head, resolved: args.resolved })
      return 'committed'
    }
    const refusal = outcome.refusal
    if (refusal.kind === 'stale-epoch' || refusal.kind === 'lease-expired') {
      this.lost(new LeaseLostError(`the lease was lost: ${refusal.kind}`, refusal.kind))
    }
    if (refusal.kind !== 'seq-mismatch') {
      throw new RecordCorruptionError(`append refused: ${JSON.stringify(refusal)}`)
    }
    await resyncHead({ plane: this.args.plane, threadId: args.threadId }, this.cache)
    if (this.replyLost({ events: args.events })) return 'committed'
    throw new RecordCorruptionError(
      `append refused with seq-mismatch at ${args.events[0]?.seq ?? -1} and the recorded chain differs`,
    )
  }

  private replyLost(args: { events: V2Event[] }): boolean {
    const first = args.events[0]
    if (first === undefined) return false
    return args.events.every(
      (event) => this.cache.committedHashAtSeq(event.seq) === chainHash(event),
    )
  }

  private lost(error: unknown): never {
    const lost =
      error instanceof LeaseLostError
        ? error
        : new LeaseLostError(`the record store failed: ${messageOf(error)}`, 'store-error')
    this.args.onLeaseLost?.(lost)
    throw lost
  }

  private async sleep(ms: number): Promise<void> {
    const jittered = ms * (0.5 + this.args.timers.random())
    const until = this.args.retryUntil?.()
    const capped =
      until === undefined
        ? jittered
        : Math.min(jittered, Math.max(0, until - this.args.timers.now()))
    await new Promise<void>((resolve) => {
      this.wakeSleep = resolve
      this.args.timers.setTimeout(() => {
        this.wakeSleep = undefined
        resolve()
      }, capped)
    })
  }
}
