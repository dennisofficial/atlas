import { describe, expect, it } from 'bun:test'
import {
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  EWorkspaceStep,
  EWorkspaceStepState,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { createFollowerLogWriter } from '../follower-writer'
import { createSessionFollower } from '../session-follower'
import { memorySessionLog, type SessionLog } from '../session-log'
import { restoredWindowOf } from '../session-log-restore'
import { createSessionLogWriter } from '../session-log-writer'
import { createStreamConnection } from '../stream-connection'
import { applyPageOutcome, type SessionCursor } from '../session-window'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
  headOf,
  mintEvents,
  settle,
} from './support'
import { replayOf, tailBaseMessageOf } from './tail-support'

const SESSION = 'checkpoint-session'

const logOf = (): SessionLog => {
  const log = memorySessionLog()
  let head: SessionCursor | undefined
  return {
    ...log,
    appendPage: async (args) => {
      await log.appendPage(args)
      head = args.head
    },
    loadSnapshot: async (sessionId) => {
      const snapshot = await log.loadSnapshot(sessionId)
      return snapshot === undefined || head === undefined ? snapshot : { ...snapshot, cursor: head }
    },
  }
}

const fixtureOf = () => {
  const bodies: RecordEventBody[] = Array.from({ length: 18 }, (_, index) => ({
    type: 'user-said',
    text: `message ${index}`,
    clientId: `client-${index}`,
  }))
  bodies[7] = { type: 'input-posted', inboxId: 1, kind: 'message', postedAt: '2026-11-05' }
  bodies[9] = {
    type: 'workspace-step',
    step: EWorkspaceStep.Setup,
    state: EWorkspaceStepState.Done,
    command: 'bun install',
    attempt: 1,
  }
  bodies[10] = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }
  bodies[11] = {
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'done' }],
    usage: { inputTokens: 100, outputTokens: 10, providerId: 'provider', modelId: 'model' },
  }
  bodies[13] = {
    type: 'turn-ended',
    turnId: 'turn-1',
    outcome: ETurnOutcome.Completed,
    by: ETurnEndedBy.Agent,
  }
  bodies[16] = { type: 'input-consumed', inboxId: 1 }
  const all = mintEvents({ bodies })
  const base = tailBaseMessageOf({ all, full: replayOf(all), tailFrom: 7 })
  return { all, base }
}

const followerOf = (log: SessionLog) => {
  const clock = createFakeScheduler()
  const follower = createSessionFollower({
    log,
    sessionId: SESSION,
    scheduler: clock.scheduler,
    onResnap: () => {},
  })
  return { follower, clock }
}

const restoreOf = (log: SessionLog) =>
  restoredWindowOf({ log, sessionId: SESSION, renderLimit: 200 })

describe('session cache checkpoints', () => {
  it('saves a base while its cursor is behind the folded view', async () => {
    const log = logOf()
    const { follower } = followerOf(log)
    await follower.hydrated
    const { base } = fixtureOf()
    follower.handleMessage(base)
    await settle()
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(6)
    const restored = await restoreOf(log)
    expect(restored?.cursor?.seq).toBe(6)
    expect(restored?.foldedThrough).toBe(18)
  })

  it('restores three partial tail pages and resumes without folding them twice', async () => {
    const log = logOf()
    const { follower } = followerOf(log)
    await follower.hydrated
    const { all, base } = fixtureOf()
    follower.handleMessage(base)
    await settle()
    for (const start of [6, 9, 12]) {
      follower.handleMessage(
        eventsMessage({ id: 's1', events: all.slice(start, start + 3), live: false }),
      )
      await settle()
    }
    const fromBaseCheckpoint = await restoreOf(log)
    expect(fromBaseCheckpoint?.cursor?.seq).toBe(15)
    expect(fromBaseCheckpoint?.foldedThrough).toBe(18)
    follower.checkpoint()
    await settle()
    const restored = await restoreOf(log)
    if (restored === undefined) throw new Error('checkpoint did not restore')
    const fresh = followerOf(log).follower
    await fresh.hydrated
    expect(fresh.cursor()?.seq).toBe(15)
    const page = eventsMessage({ id: 's1', events: all.slice(15), live: true })
    follower.handleMessage(page)
    fresh.handleMessage(page)
    const resumed = applyPageOutcome({
      window: restored,
      page: { events: all.slice(15), head: headOf(all) },
    }).window
    expect(fromBaseCheckpoint?.commandLog).toEqual(restored.commandLog)
    expect(fromBaseCheckpoint?.quickStops).toEqual(restored.quickStops)
    expect(fromBaseCheckpoint?.durable).toEqual(restored.durable)
    expect(fresh.getSnapshot().view).toEqual(follower.getSnapshot().view)
    await settle()
    const finished = await restoreOf(log)
    if (finished === undefined) throw new Error('live checkpoint did not restore')
    expect(resumed.commandLog).toEqual(finished.commandLog)
    expect(resumed.quickStops).toEqual(finished.quickStops)
    expect(resumed.durable).toEqual(finished.durable)
    expect(resumed.view).toEqual(finished.view)
  })

  it('writes the live cursor immediately instead of waiting for the throttle', async () => {
    const log = logOf()
    const { follower } = followerOf(log)
    await follower.hydrated
    const { all, base } = fixtureOf()
    follower.handleMessage(base)
    await settle()
    follower.handleMessage(eventsMessage({ id: 's1', events: all.slice(6, 9), live: false }))
    await settle()
    follower.handleMessage(eventsMessage({ id: 's1', events: all.slice(9), live: true }))
    await settle()
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(18)
    const fresh = followerOf(log).follower
    await fresh.hydrated
    expect(fresh.cursor()?.seq).toBe(18)
  })

  it.each(['follow', 'connection'])('checkpoints on %s close before live', async (kind) => {
    const log = logOf()
    const clock = createFakeScheduler()
    const fake = createFakeTransport()
    const connection = createStreamConnection({
      transport: fake.transport,
      scheduler: clock.scheduler,
    })
    const followed = connection.follow({ sessionId: SESSION, log })
    await followed.hydrated
    await settle()
    const { all, base } = fixtureOf()
    fake.follows[0]?.handlers.handleFrame(base)
    await settle()
    fake.follows[0]?.handlers.handleFrame(
      eventsMessage({ id: 's1', events: all.slice(6, 15), live: false }),
    )
    await settle()
    if (kind === 'follow') followed.close()
    else connection.close()
    await settle()
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(15)
    const fresh = followerOf(log).follower
    await fresh.hydrated
    expect(fresh.cursor()?.seq).toBe(15)
  })

  it('folds only the gap after the saved base view boundary', async () => {
    const log = logOf()
    const { follower } = followerOf(log)
    await follower.hydrated
    const { all, base } = fixtureOf()
    follower.handleMessage(base)
    await settle()
    const initial = await restoreOf(log)
    if (initial === undefined) throw new Error('base did not restore')
    const added = mintEvents({
      from: headOf(all),
      bodies: [
        { type: 'input-posted', inboxId: 2, kind: 'message', postedAt: '2026-11-05' },
        {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'later' }],
          usage: { inputTokens: 50, outputTokens: 5, providerId: 'provider', modelId: 'model' },
        },
      ],
    })
    const events = [...all.slice(6), ...added]
    const page = { events, head: headOf(events) }
    const expected = applyPageOutcome({ window: initial, page }).window
    await log.appendPage({ sessionId: SESSION, ...page })

    const restored = await restoreOf(log)
    expect(restored?.cursor?.seq).toBe(20)
    expect(restored?.view).toEqual(expected.view)
    expect(restored?.pending).toEqual(expected.pending)
    expect(restored?.failureMessage).toEqual(expected.failureMessage)
    expect(restored?.visibility).toEqual(expected.visibility)
    expect(restored?.commandLog).toEqual(expected.commandLog)
    expect(restored?.quickStops).toEqual(expected.quickStops)
    expect(restored?.durable).toEqual(expected.durable)
  })

  it('cancels a pending throttled save when it checkpoints', async () => {
    const log = memorySessionLog()
    const clock = createFakeScheduler()
    const { all } = fixtureOf()
    const writer = createFollowerLogWriter({
      log,
      sessionId: SESSION,
      scheduler: clock.scheduler,
      windowOf: () => replayOf(all),
    })
    writer.saveThrottled()
    await settle()
    writer.saveThrottled()
    expect(clock.pendingCount()).toBe(1)
    writer.checkpoint()
    await settle()
    expect(clock.pendingCount()).toBe(0)
    expect(log.saveCount()).toBe(2)
    clock.advance(1_000)
    await settle()
    expect(log.saveCount()).toBe(2)
  })

  it('lets the log writer persist a cursor below the fold boundary', async () => {
    const log = memorySessionLog()
    const { all } = fixtureOf()
    const writer = createSessionLogWriter({ log, sessionId: SESSION })
    writer.save({ ...replayOf(all), cursor: { seq: 6, hash: 'h6' }, foldedThrough: 18 })
    await settle()
    expect((await log.loadSnapshot(SESSION))?.foldedThrough).toBe(18)
    expect((await log.loadSnapshot(SESSION))?.throughSeq).toBe(6)
  })
})
