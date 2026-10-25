import { EThreadStreamFrame } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { applyPodEvents, truncatePodEvents } from '../sandboxes/pod-events'
import { EventsService } from './events.service'
import { recordingSignals } from './thread-signals.fixture'

const draft = (type: string) => ({ type, body: JSON.stringify({ type }) })
const podEvent = (seq: number) => ({
  seq,
  runId: 'run_pod',
  depth: 0,
  at: '2026-10-22T10:00:00.000Z',
  type: 'assistant-said',
  body: '{}',
})
const head = (value: number) => ({ type: EThreadStreamFrame.Head, head: value })

describe('head-moving writes publish headMoved after commit', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
    await seedThreadRow({ id: 'thr-1', userId: USER_A, head: 0 })
  })

  it('append signals the new head', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await new EventsService(signals).append({
      userId: USER_A,
      threadId: 'thr-1',
      draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
    })

    expect(frames).toEqual([head(2)])
  })

  it('append signals nothing when there is nothing to append', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await new EventsService(signals).append({
      userId: USER_A,
      threadId: 'thr-1',
      draft: { runId: 'run_1', drafts: [] },
    })

    expect(frames).toEqual([])
  })

  it('replace signals the rewritten head', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await new EventsService(signals).replace({
      userId: USER_A,
      threadId: 'thr-1',
      draft: { runId: 'run_1', drafts: [draft('user-said'), draft('assistant-said')] },
    })

    expect(frames).toEqual([head(2)])
  })

  it('applyPodEvents signals a moved head, and an identical re-post signals nothing', async () => {
    const { signals, framesOf } = recordingSignals()
    const frames = framesOf('thr-1')

    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1), podEvent(2)], signals })
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1), podEvent(2)], signals })

    expect(frames).toEqual([head(2)])
  })

  it('truncatePodEvents signals a lowered head only when it moved', async () => {
    const { signals, framesOf } = recordingSignals()
    await applyPodEvents({ threadId: 'thr-1', events: [podEvent(1), podEvent(2)], signals })
    const frames = framesOf('thr-1')

    await truncatePodEvents({ threadId: 'thr-1', toSeq: 1, signals })
    await truncatePodEvents({ threadId: 'thr-1', toSeq: 1, signals })

    expect(frames).toEqual([head(1)])
  })
})
