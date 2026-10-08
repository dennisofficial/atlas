import { describe, expect, it } from 'bun:test'

import { EServiceStatus, toThreadId } from '@dltech/atlas-core'

import { ServiceNoticeQueue, serviceEndedDraft } from '../service-notices'
import type { ServiceSnapshot } from '../service-process'

const THREAD = toThreadId('thread-under-test')
const CHILD = toThreadId('child-thread')
const PARENT = toThreadId('parent-thread')

const snapshotOf = (serviceId: string): ServiceSnapshot => ({
  serviceId,
  command: 'sleep 30',
  description: 'a dev server',
  status: EServiceStatus.Exited,
  exitCode: 0,
  logPath: '/tmp/atlas-test/services/x.log',
  startedAt: '2026-08-27T12:00:00.000Z',
  endedAt: '2026-08-27T12:00:01.000Z',
})

const noticeOf = (serviceId: string, threadId: ReturnType<typeof toThreadId>) => ({
  snapshot: snapshotOf(serviceId),
  threadId,
  draft: serviceEndedDraft({ snapshot: snapshotOf(serviceId) }),
})

describe('reassigning a finished thread’s service notices', () => {
  it('moves every queued notice to the parent, preserving order', () => {
    const queue = new ServiceNoticeQueue({ logged: false })
    queue.queue(noticeOf('svc_1', CHILD))
    queue.queue(noticeOf('svc_2', CHILD))

    queue.reassign({ from: CHILD, to: PARENT })

    expect(queue.pending({ threadId: CHILD })).toEqual([])
    expect(queue.pending({ threadId: PARENT }).map((notice) => notice.serviceId)).toEqual([
      'svc_1',
      'svc_2',
    ])
    expect(queue.threadsAwaiting()).toEqual([PARENT])
  })

  it('leaves other threads’ notices where they are', () => {
    const queue = new ServiceNoticeQueue({ logged: false })
    queue.queue(noticeOf('svc_1', CHILD))
    queue.queue(noticeOf('svc_2', THREAD))

    queue.reassign({ from: CHILD, to: PARENT })

    expect(queue.pending({ threadId: THREAD })).toHaveLength(1)
    expect(queue.pending({ threadId: PARENT })).toHaveLength(1)
  })

  it('is a no-op when the finished thread left nothing, and never fires a listener', () => {
    const queue = new ServiceNoticeQueue({ logged: false })
    queue.queue(noticeOf('svc_1', THREAD))
    let rang = 0
    queue.onNotice(() => { rang += 1 })

    queue.reassign({ from: CHILD, to: PARENT })

    expect(rang).toBe(0)
    expect(queue.pending({ threadId: THREAD })).toHaveLength(1)
  })

  it('is a no-op when from and to are the same thread', () => {
    const queue = new ServiceNoticeQueue({ logged: false })
    queue.queue(noticeOf('svc_1', CHILD))

    queue.reassign({ from: CHILD, to: CHILD })

    expect(queue.pending({ threadId: CHILD })).toHaveLength(1)
  })

  it('lets the inheriting parent drain what the child never could', () => {
    const queue = new ServiceNoticeQueue({ logged: false })
    queue.queue(noticeOf('svc_1', CHILD))

    queue.reassign({ from: CHILD, to: PARENT })

    const batch = queue.prepare({ threadId: PARENT })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts.map((draft) => draft.type)).toEqual(['service-ended'])
    batch.acknowledge()
    expect(queue.pending({ threadId: PARENT })).toEqual([])
  })
})
