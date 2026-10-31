import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  eventsOf,
  seedEventRow,
  seedThreadRow,
  seedUsers,
  threadById,
  USER_A,
} from '../../../../test/session-seed'
import { applyPodEvents, truncatePodEvents } from '../sandboxes/pod-events'
import { EventsService } from './events.service'
import { recordingSignals } from './thread-signals.fixture'
import { ThreadsHistoryService } from './threads-history.service'

const draft = (type: string) => ({ type, body: JSON.stringify({ type }) })
const context = {
  ...draft('context-loaded'),
  contextSlot: 'file',
  contextKey: 'a',
  contextDigest: 'same',
}
const podEvent = (seq: number) => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: '{}',
})
const head = (args: { head: number; historyRev: number }): ThreadStreamFrame => ({
  type: EThreadStreamFrame.Head,
  ...args,
})
const reset = (args: { head: number; historyRev: number }): ThreadStreamFrame => ({
  type: EThreadStreamFrame.Reset,
  ...args,
})
const target = { userId: USER_A, threadId: 'thr-1' }

describe('event writers publish committed event frames', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'thr-1', userId: USER_A, head: 0 })
  })

  it('append publishes stored rows and a backwards-compatible head', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')
    const events = await new EventsService(signals).append({
      ...target,
      draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
    })
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 1, events, historyRev: 0 },
      head({ head: 2, historyRev: 0 }),
    ])
  })

  it('empty append signals nothing', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')
    await new EventsService(signals).append({ ...target, draft: { runId: 'run_1', drafts: [] } })
    expect(frames).toEqual([])
  })

  it('publishes fresh rows once rather than context duplicates or an old reused head', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new EventsService(signals)
    await service.append({ ...target, draft: { runId: 'old', drafts: [context] } })
    await service.append({ ...target, draft: { runId: 'next', drafts: [draft('user-said')] } })
    const frames = framesOf('thr-1')
    const reused = await service.append({ ...target, draft: { runId: 'reuse', drafts: [context] } })
    expect(reused[0]?.seq).toBe(1)
    expect(frames).toEqual([])
    const events = await service.append({
      ...target,
      draft: {
        runId: 'mixed',
        drafts: [
          context,
          { ...context, contextDigest: 'new' },
          { ...context, contextDigest: 'new' },
        ],
      },
    })
    expect(events.map((event) => event.seq)).toEqual([1, 3, 3])
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 3, events: events.slice(1, 2), historyRev: 0 },
      head({ head: 3, historyRev: 0 }),
    ])
  })

  it('does not publish an inherited context row as a new child event', async () => {
    const { signals, framesOf } = recordingSignals()
    const service = new EventsService(signals)
    await service.append({ ...target, draft: { runId: 'parent', drafts: [context] } })
    const fork = await new ThreadsHistoryService(signals).fork({
      ...target,
      draft: { seq: 1, mode: 'reference' },
    })
    const frames = framesOf(fork.id)
    const reply = await service.append({
      userId: USER_A,
      threadId: fork.id,
      draft: { runId: 'child', drafts: [context, draft('user-said')] },
    })
    expect(reply.map((event) => event.seq)).toEqual([1, 2])
    expect(frames).toEqual([
      { type: EThreadStreamFrame.Events, fromSeq: 2, events: reply.slice(1), historyRev: 0 },
      head({ head: 2, historyRev: 0 }),
    ])
  })

  it('replace publishes reset even when the head does not move', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')
    await new EventsService(signals).replace({
      ...target,
      draft: { runId: 'run_1', drafts: [] },
    })
    expect(frames).toEqual([reset({ head: 0, historyRev: 1 }), head({ head: 0, historyRev: 1 })])
  })

  it('pod import publishes stored rows, but identical or empty retries publish nothing', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1), podEvent(2)], signals })
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1), podEvent(2)], signals })
    await applyPodEvents({ threadId: 'thr-1', events: [], signals })
    expect(frames).toEqual([
      {
        type: EThreadStreamFrame.Events,
        fromSeq: 1,
        historyRev: 0,
        events: [
          expect.objectContaining({ seq: 1, id: expect.any(String) }),
          expect.objectContaining({ seq: 2 }),
        ],
      },
      head({ head: 2, historyRev: 0 }),
    ])
    expect(await threadById('thr-1')).toMatchObject({ historyRev: 0 })
  })

  it('conflicting existing-seq pod writes reject without overwriting or changing epoch', async () => {
    const { signals, framesOf } = recordingSignals()
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1)], signals })
    const frames = framesOf('thr-1')
    await expect(
      applyPodEvents({
        threadId: 'thr-1',
        events: [{ ...podEvent(1), body: 'changed' }],
        signals,
      }),
    ).rejects.toMatchObject({ status: 409 })
    expect(frames).toEqual([])
    expect(await threadById('thr-1')).toMatchObject({ head: 1, historyRev: 0 })
  })

  it('same-head truncate still bumps when it removes rows beyond the stored head', async () => {
    const { signals, framesOf } = recordingSignals()
    await seedEventRow({ threadId: 'thr-1', seq: 1 })
    const frames = framesOf('thr-1')
    await truncatePodEvents({ threadId: 'thr-1', toSeq: 0, signals })
    expect(await eventsOf('thr-1')).toEqual([])
    expect(await threadById('thr-1')).toMatchObject({ head: 0, historyRev: 1 })
    expect(frames).toEqual([reset({ head: 0, historyRev: 1 }), head({ head: 0, historyRev: 1 })])
  })

  it('pod truncate increments once and a repeated or ahead truncate remains a no-op', async () => {
    const { signals, framesOf } = recordingSignals()
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1), podEvent(2)], signals })
    const frames = framesOf('thr-1')
    await truncatePodEvents({ threadId: 'thr-1', toSeq: 1, signals })
    await truncatePodEvents({ threadId: 'thr-1', toSeq: 1, signals })
    await truncatePodEvents({ threadId: 'thr-1', toSeq: 10, signals })
    expect(frames).toEqual([reset({ head: 1, historyRev: 1 }), head({ head: 1, historyRev: 1 })])
    expect(await threadById('thr-1')).toMatchObject({ head: 1, historyRev: 1 })
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(2)], signals })
    expect(await threadById('thr-1')).toMatchObject({ head: 2, historyRev: 1 })
    expect(frames[2]).toMatchObject({ type: EThreadStreamFrame.Events, historyRev: 1 })
  })
})
