import { describe, expect, it } from 'bun:test'

import { EServiceStatus, ENoticeStage, toThreadId } from '@dltech/atlas-core'

import { requeueOwedServiceNotices } from '../owed-notices'
import { ServiceNoticeQueue } from '../service-notices'
import { MemoryLog, SequenceIds } from './recovery-fixture'

const thread = toThreadId('thread-1')

const ended = (stage: ENoticeStage) =>
  ({
    type: 'service-ended',
    serviceId: 'svc_1',
    command: 'bun run dev',
    status: EServiceStatus.Exited,
    tail: 'bye',
    notice: { id: 'n1', stage },
  }) as const

describe('a service ending that arrived before a restart', () => {
  it('is delivered once from the log by a fresh queue', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [ended(ENoticeStage.Arrived)],
    })
    const queue = new ServiceNoticeQueue()
    const events = await log.readOwn({ threadId: thread })

    requeueOwedServiceNotices({ events, threadId: thread, notices: queue })
    requeueOwedServiceNotices({ events, threadId: thread, notices: queue })

    const batch = queue.prepare({ threadId: thread })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts).toEqual([
      expect.objectContaining({
        type: 'service-ended',
        notice: { id: 'n1', stage: ENoticeStage.Delivered },
      }),
    ])
    batch.acknowledge()
    expect(queue.prepare({ threadId: thread }).drafts).toEqual([])
  })

  it('is not queued once its delivered row is in the log', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [ended(ENoticeStage.Arrived), ended(ENoticeStage.Delivered)],
    })
    const queue = new ServiceNoticeQueue()

    requeueOwedServiceNotices({
      events: await log.readOwn({ threadId: thread }),
      threadId: thread,
      notices: queue,
    })

    expect(queue.pending({ threadId: thread })).toEqual([])
  })
})
