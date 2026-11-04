import { OnceLedger } from '@dltech/atlas-agent'
import type { RunId, ThreadId } from '@dltech/atlas-core'

import type { RecordCache } from './record-cache'
import type { SessionRecord } from './record-adapter'

type Inflight = { promise: Promise<unknown> }

export class V2OnceLedger extends OnceLedger {
  private readonly inflight = new Map<string, Inflight>()

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
    const recorded = this.lookup(args.key)
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

  private lookup(key: string): { found: true; value: unknown } | { found: false } {
    for (const event of this.args.cache.resolvedAll()) {
      if (event.type === 'fact-recorded' && event.key === key) {
        return { found: true, value: event.value }
      }
    }
    return { found: false }
  }
}
