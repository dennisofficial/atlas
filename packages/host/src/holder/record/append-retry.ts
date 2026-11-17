import {
  chainHash,
  type BlobPayload,
  type RunId,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import {
  RecordCorruptError,
  UnknownThreadError,
  type AppendOutcome,
  type ControlPlane,
} from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'

import type { RemoteCalls } from '../../calls/remote-calls'
import type { HostTimers } from '../ports'
import { RecordCorruptionError } from './append-drafts'
import { LeaseLostError } from './lease-lost-error'
import type { RecordCache } from './record-cache'
import { ackDaemonScope, resyncHead } from './record-commit'
import { appendRetryDeadline } from './retry-deadline'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type AppendRetryArgs = {
  plane: ControlPlane
  threadId: ThreadId
  epoch: number
  cache: RecordCache
  daemonTools: ReadonlySet<string>
  remoteCalls: RemoteCalls
  timers: HostTimers
  appendRetryMs?: number | undefined
  log?: LogPort | undefined
  isFenced(): boolean
  onLeaseLost?: ((error: LeaseLostError) => void) | undefined
}

export class AppendRetry {
  private wakeSleep: (() => void) | undefined

  constructor(private readonly args: AppendRetryArgs) {}

  wake(): void {
    this.wakeSleep?.()
  }

  async commit(args: {
    threadId: ThreadId
    events: V2Event[]
    blobs: readonly BlobPayload[]
    resolved: ReadonlyMap<string, unknown>
    ackDaemon?: { callId: string; name: string; runId: RunId } | undefined
  }): Promise<void> {
    let delayMs = 100
    let failingSince: number | undefined
    for (;;) {
      if (this.args.isFenced()) {
        throw new LeaseLostError('the holder self-fenced; no append is attempted', 'self-fenced')
      }
      const deadline = failingSince === undefined ? undefined : this.retryDeadline(failingSince)
      if (deadline !== undefined && this.args.timers.now() >= deadline) {
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
        await this.args.cache.refillIfRevealed()
        return
      }
      failingSince ??= this.args.timers.now()
      await this.sleep({ ms: delayMs, until: this.retryDeadline(failingSince) })
      delayMs = Math.min(delayMs * 2, 2_000)
    }
  }

  private retryDeadline(failingSince: number): number {
    return appendRetryDeadline({ failingSince, appendRetryMs: this.args.appendRetryMs })
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
    } catch (error) {
      if (error instanceof UnknownThreadError || error instanceof RecordCorruptError) {
        throw new RecordCorruptionError(`append failed permanently: ${messageOf(error)}`)
      }
      return 'retry'
    }
    if (outcome.ok) {
      this.args.cache.extend({ events: args.events, head: outcome.head, resolved: args.resolved })
      return 'committed'
    }
    const refusal = outcome.refusal
    if (refusal.kind === 'stale-epoch') {
      this.lost(new LeaseLostError(`the lease was lost: ${refusal.kind}`, refusal.kind))
    }
    if (refusal.kind !== 'seq-mismatch') {
      throw new RecordCorruptionError(`append refused: ${JSON.stringify(refusal)}`)
    }
    await resyncHead({ plane: this.args.plane, threadId: this.args.threadId }, this.args.cache)
    if (this.replyLost({ events: args.events })) return 'committed'
    throw new RecordCorruptionError(
      `append refused with seq-mismatch at ${args.events[0]?.seq ?? -1} and the recorded chain differs`,
    )
  }

  private replyLost(args: { events: V2Event[] }): boolean {
    if (args.events.length === 0) return false
    return args.events.every(
      (event) => this.args.cache.committedHashAtSeq(event.seq) === chainHash(event),
    )
  }

  private lost(error: unknown): never {
    const lost =
      error instanceof LeaseLostError
        ? error
        : new LeaseLostError(`the record store failed: ${messageOf(error)}`, 'store-error')
    if (lost.refusal === 'retry-exhausted') {
      this.args.log?.warn({ source: 'holder.append', message: 'append retry exhausted' })
    }
    this.args.onLeaseLost?.(lost)
    throw lost
  }

  private async sleep(args: { ms: number; until: number }): Promise<void> {
    const jittered = args.ms * (0.5 + this.args.timers.random())
    const capped = Math.min(jittered, Math.max(0, args.until - this.args.timers.now()))
    await new Promise<void>((resolve) => {
      this.wakeSleep = resolve
      this.args.timers.setTimeout(() => {
        this.wakeSleep = undefined
        resolve()
      }, capped)
    })
  }
}
