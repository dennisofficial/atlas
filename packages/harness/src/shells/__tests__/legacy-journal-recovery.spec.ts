import { describe, expect, it } from 'bun:test'
import { EventLogPort, lostShellsOf, stampDrafts, toEventId, toRunId, toThreadId, type Event, type EventDraft, type RunId, type ThreadId } from '@dltech/atlas-core'

import { ShellRecovery } from '../recovery'
import { RandomIds } from '../../store/ids'

const OWNER = toThreadId('legacy-journal-owner')

class LegacyLog extends EventLogPort {
  private events: Event[] = []

  async append(args: { threadId: ThreadId; runId: RunId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    const head = this.events.length
    const stamped = stampDrafts({
      drafts: args.drafts,
      envelopes: args.drafts.map((_, index) => ({
        id: toEventId(`event-${head + index + 1}`),
        seq: head + index + 1,
        threadId: args.threadId,
        runId: args.runId,
        depth: 0,
        at: '2026-01-01T00:00:00.000Z',
      })),
    })
    this.events.push(...stamped)
    return stamped
  }

  async read(): Promise<Event[]> { return this.events }
  async readOwn(): Promise<Event[]> { return this.events }
  async head(): Promise<number> { return this.events.length }
  async refresh(): Promise<void> {}
  async replace(): Promise<Event[]> { throw new Error('this recovery test never rewrites history') }
}

for (const boots of [['old-boot-a', 'old-boot-b'], ['old-boot-a', 'old-boot-a'], [undefined, undefined]]) {
  describe(`recovering recycled legacy shell ids (${boots.join(',')})`, () => {
    it('settles each unresolved start and leaves subsequent reconciliation empty', async () => {
      const log = new LegacyLog()
      await log.append({
        threadId: OWNER,
        runId: toRunId('legacy-starts'),
        drafts: boots.map((bootId) => ({ type: 'background-shell-started', shellId: 'bash_1', command: 'old work', bootId })),
      })
      const recovery = new ShellRecovery({ log, ids: new RandomIds() })
      expect(await recovery.recordLost({ threadId: OWNER })).toHaveLength(2)
      const events = await log.readOwn()
      expect(events.filter((event) => event.type === 'background-shell-ended')).toHaveLength(2)
      expect(lostShellsOf(events)).toEqual([])
      expect(await recovery.recordLost({ threadId: OWNER })).toEqual([])
    })
  })
}
