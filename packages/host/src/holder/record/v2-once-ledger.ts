import { OnceLedger } from '@dltech/atlas-agent'
import type { RunId, ScheduledRetry, ThreadId } from '@dltech/atlas-core'

import type { RecordCache } from './record-cache'
import type { SessionRecord } from './record-adapter'

type Inflight = { promise: Promise<unknown> }

export class V2OnceLedger extends OnceLedger {
  private readonly inflight = new Map<string, Inflight>()
  private readonly inflightRetries = new Map<string, Promise<ScheduledRetry>>()

  constructor(
    private readonly args: {
      cache: RecordCache
      record: Pick<SessionRecord, 'append'>
      threadId: ThreadId
      runId: () => RunId
    },
  ) {
    super()
  }

  async once<T>(args: { key: string; decide: () => Promise<T> }): Promise<T> {
    const recorded = this.args.cache.bookkeeping().fact(args.key)
    if (recorded.found) return recorded.value as T
    const shared = this.shared(args)
    return (await shared.promise) as T
  }

  private shared(args: { key: string; decide: () => Promise<unknown> }): Inflight {
    const running = this.inflight.get(args.key)
    if (running !== undefined) return running
    const promise = this.decideAndRecord(args).finally(() => {
      this.inflight.delete(args.key)
    })
    const inflight: Inflight = { promise }
    this.inflight.set(args.key, inflight)
    return inflight
  }

  private async decideAndRecord(args: {
    key: string
    decide: () => Promise<unknown>
  }): Promise<unknown> {
    const value = await args.decide()
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts: [
        { type: 'fact-recorded', key: args.key, kind: args.key.split(':')[0] ?? 'fact', value },
      ],
    })
    return value
  }

  async scheduleRetry(args: {
    key: string
    decide: () => Promise<Omit<ScheduledRetry, 'key'>>
  }): Promise<ScheduledRetry> {
    const recorded = this.args.cache.bookkeeping().retry(args.key)
    if (recorded !== undefined) return recorded
    const running = this.inflightRetries.get(args.key)
    if (running !== undefined) return running
    const promise = this.decideAndRecordRetry(args).finally(() => {
      this.inflightRetries.delete(args.key)
    })
    this.inflightRetries.set(args.key, promise)
    return promise
  }

  recallRetries(args: { prefix: string }): Promise<readonly ScheduledRetry[]> {
    return Promise.resolve(this.args.cache.bookkeeping().retriesWithPrefix(args.prefix))
  }

  private async decideAndRecordRetry(args: {
    key: string
    decide: () => Promise<Omit<ScheduledRetry, 'key'>>
  }): Promise<ScheduledRetry> {
    const decided = await args.decide()
    const retry: ScheduledRetry = { key: args.key, ...decided }
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts: [{ type: 'retry-scheduled', ...retry }],
    })
    return retry
  }

  recall(args: { prefix: string }): Promise<readonly { key: string; value: unknown }[]> {
    return Promise.resolve(this.args.cache.bookkeeping().factsWithPrefix(args.prefix))
  }
}
