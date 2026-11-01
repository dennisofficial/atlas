import { describe, expect, it } from 'bun:test'

import {
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventBody,
  type WaitingForModel,
} from '@dltech/atlas-core'

import { createDeltaChannel } from '../../channel/delta-channel'
import { waitingOfBlock } from '../../model-recovery/waiting-of-block'
import { blockedError } from '../../model-recovery/__tests__/block-fixtures'
import { bindThreadActivity, createActivityTracker, type ActivityReport } from '../index'
import { RuntimeSessionActivity } from '../runtime-session-activity'

const threadId = toThreadId('root')
const waiting: WaitingForModel = waitingOfBlock({
  error: blockedError(),
  threadId,
})

const event = ({ body, seq }: { body: EventBody; seq: number }): Event => ({
  id: toEventId(`event-${seq}`),
  seq,
  threadId,
  runId: toRunId('run'),
  depth: 0,
  at: '2026-11-01T00:00:00Z',
  ...body,
})

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('activity tracker waiting', () => {
  it('projects waitingForModel independently of awaiting and working', () => {
    const reports: ActivityReport[] = []
    const tracker = createActivityTracker({
      report: (state) => reports.push(state),
    })
    tracker.setWaiting(waiting)
    tracker.setBackground(true)
    tracker.setInput(true)
    expect(reports.at(-1)).toEqual({
      working: true,
      awaiting: 'input',
      waitingForModel: waiting,
    })
  })

  it('survives turn start and end and clears only on an explicit clear', () => {
    const reports: ActivityReport[] = []
    const tracker = createActivityTracker({
      report: (state) => reports.push(state),
    })
    tracker.setWaiting(waiting)
    tracker.turnStarted()
    tracker.turnEnded()
    expect(reports.at(-1)?.waitingForModel).toEqual(waiting)
    tracker.setWaiting(null)
    expect(reports.at(-1)).not.toHaveProperty('waitingForModel')
  })

  it('does not report a duplicate for an unchanged waiting value', () => {
    const reports: ActivityReport[] = []
    const tracker = createActivityTracker({
      report: (state) => reports.push(state),
    })
    tracker.setWaiting(waiting)
    tracker.setWaiting({ ...waiting })
    expect(reports).toHaveLength(1)
  })
})

describe('thread activity binding waiting', () => {
  it('follows model-waiting and model-wait-cleared events from the own log', async () => {
    const stored: Event[] = []
    const reports: ActivityReport[] = []
    const channel = createDeltaChannel()
    const binding = bindThreadActivity({
      threadId,
      channel,
      log: {
        head: async () => stored.at(-1)?.seq ?? 0,
        readOwn: async ({ fromSeq }) => stored.filter((one) => one.seq > (fromSeq ?? 0)),
      },
      report: (state) => reports.push(state),
    })
    const publisher = channel.publisherFor({ threadId })

    stored.push(event({ seq: 2, body: { type: 'model-waiting', waiting } }))
    publisher.eventsAppended()
    await flush()
    expect(reports.at(-1)?.waitingForModel).toEqual(waiting)

    binding.tracker.turnStarted()
    binding.tracker.turnEnded()
    expect(reports.at(-1)?.waitingForModel).toEqual(waiting)

    stored.push(
      event({
        seq: 4,
        body: {
          type: 'model-wait-cleared',
          episode: waiting.episode,
          cause: waiting.cause,
        },
      }),
    )
    publisher.eventsAppended()
    await flush()
    expect(reports.at(-1)).not.toHaveProperty('waitingForModel')
    binding.detach()
  })
})

describe('runtime session activity waiting', () => {
  it('rebuilds waiting from the log on read and keeps it with a running shell', async () => {
    const events = [event({ seq: 1, body: { type: 'model-waiting', waiting } })]
    const activity = new RuntimeSessionActivity({
      runtimeId: 'runtime',
      log: { refresh: async () => {}, readOwn: async () => events },
      input: { pending: () => null },
      channel: createDeltaChannel(),
      roster: {
        read: async () => ({
          agents: [],
          shells: [
            {
              shellId: 'sh',
              status: 'running',
            } as never,
          ],
        }),
        subscribe: () => () => {},
      },
    })
    const read = await activity.read({ threadId })
    expect(read.waitingForModel).toEqual(waiting)
    expect(read.working).toBe(true)
    activity.close()
  })

  it('omits waitingForModel when nothing waits', async () => {
    const activity = new RuntimeSessionActivity({
      runtimeId: 'runtime',
      log: { refresh: async () => {}, readOwn: async () => [] },
      input: { pending: () => null },
      channel: createDeltaChannel(),
      roster: {
        read: async () => ({ agents: [], shells: [] }),
        subscribe: () => () => {},
      },
    })
    expect(await activity.read({ threadId })).not.toHaveProperty('waitingForModel')
    activity.close()
  })
})
