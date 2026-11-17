import {
  EInputConsumed,
  chainEvents,
  chainHash,
  toLoopEvent,
  type Event,
  type LoopState,
  type RunId,
  type ThreadId,
  type V2Body,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { AgentRecordPort, ModelContextPort } from '@dltech/atlas-agent'
import type { LogPort } from '@dltech/atlas-observability'

import type { RemoteCalls } from '../../calls/remote-calls'
import type { HostTimers } from '../ports'
import { AppendRetry } from './append-retry'
import { LeaseLostError } from './lease-lost-error'
import { RecordCache } from './record-cache'
import { spillForAppend } from './record-spill'
import { abortedOnHandoff, inboxIdOf, toRecordBody, type AppendBody } from './append-drafts'
import { RecordCorruptionError } from './append-drafts'
import { ackRecordedDaemonResults, prepareDraft } from './record-commit'

export { LeaseLostError, RecordCorruptionError }
export type { AppendBody }

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
  appendRetryMs?: number | undefined
  onLeaseLost?: ((error: LeaseLostError) => void) | undefined
  log?: LogPort | undefined
  nowIso(): string
}

export class SessionRecord implements AgentRecordPort, ModelContextPort {
  private readonly cache: RecordCache
  private readonly retry: AppendRetry
  private tail: Promise<void> = Promise.resolve()
  private draining = false
  private fenced = false

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
  }

  fence(): void {
    this.fenced = true
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
      if (inboxId !== undefined)
        bodies.push({ type: 'input-consumed', inboxId, consumed: EInputConsumed.Message })
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
      await this.retry.commit({
        threadId: args.threadId,
        events,
        blobs: spilled.blobs,
        resolved: spilled.resolved,
        ...(draft.type === 'tool-result'
          ? { ackDaemon: { callId: draft.callId, name: draft.name, runId: args.runId } }
          : {}),
      })
      for (const event of events) {
        const loop = toLoopEvent({ event: this.cache.resolvedEvent(event) })
        if (loop !== undefined) committed.push(loop)
      }
    }
    return committed
  }
}
