import { describe, expect, it } from 'bun:test'

import {
  chainEvents,
  EHeldAction,
  EInputConsumed,
  ESetupPhase,
  EShellStatus,
  visibleLoopEvents,
  toRunId,
  toThreadId,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'

import { readHeldAction } from '../held-snapshot'
import type { HeldSessionDeps } from '../held-session-deps'
import type { SessionRecord } from '../record/record-adapter'

const THREAD = toThreadId('thr_1')
const RUN = toRunId('run_1')
const PREPARED = { prepared: true, failure: undefined }

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: THREAD,
    runId: RUN,
    epoch: 1,
    at: '2026-11-12T03:00:00.000Z',
    bodies,
  })

const depsOf = (): HeldSessionDeps =>
  ({
    sessionId: 'session-1',
    plane: {
      readInbox: async () => [],
      endTerminals: async () => 0,
    } as unknown as ControlPlane,
    timers: { now: () => 0 },
  }) as unknown as HeldSessionDeps

const recordOf = (events: readonly V2Event[]): SessionRecord =>
  ({
    eventCache: () => ({
      bookkeeping: () => ({ workspace: () => PREPARED }),
      eventsAfter: (seq: number) => events.filter((event) => event.seq > seq),
      loopEventsAfter: (seq: number) =>
        visibleLoopEvents(events.filter((event) => event.seq > seq)),
    }),
  }) as unknown as SessionRecord

const actionOf = async (args: {
  events: readonly V2Event[]
  resumeAfterSeq?: number
}): Promise<EHeldAction> => {
  const { action } = await readHeldAction({
    deps: depsOf(),
    threadId: THREAD,
    draining: false,
    turnRunning: false,
    resumeAfterSeq: args.resumeAfterSeq ?? 0,
    runtime: undefined,
    record: recordOf(args.events),
    preparing: false,
    setupRunning: false,
    childrenRunning: 0,
    shellsOwedSince: undefined,
  })
  return action
}

const posted = (): V2Body => ({
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: '2026-11-12T03:00:00.000Z',
  text: 'm4',
})

describe('readHeldAction over the pending log', () => {
  it('starts a turn for a message posted in the log with no staging row', async () => {
    expect(await actionOf({ events: eventsOf([posted()]) })).toBe(EHeldAction.StartTurn)
  })

  it('starts the answering turn once the log has said the message it posted', async () => {
    expect(
      await actionOf({
        events: eventsOf([posted(), { type: 'user-said', text: 'm4', inboxId: 4 }]),
      }),
    ).toBe(EHeldAction.StartTurn)
  })

  it('waits when nothing is pending in the inbox or the log', async () => {
    expect(await actionOf({ events: [] })).toBe(EHeldAction.Wait)
  })
})

describe('readHeldAction after a consumed stop', () => {
  const stopped = (): V2Body => ({
    type: 'input-consumed',
    inboxId: 9,
    consumed: EInputConsumed.Stop,
  })

  it('does not start a turn for a stop left between the prompt and its first reply', async () => {
    expect(await actionOf({ events: eventsOf([said('go'), stopped()]) })).toBe(EHeldAction.Wait)
  })

  it('does not resume the stopped turn on a take-over that folds the whole log', async () => {
    const interrupted: V2Body = {
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'working' }],
      interrupted: true,
      stopped: true,
    }
    expect(
      await actionOf({ events: eventsOf([said('go'), interrupted, stopped()]), resumeAfterSeq: 0 }),
    ).toBe(EHeldAction.Wait)
  })

  it('starts a turn again once the operator prompts after the stop', async () => {
    expect(await actionOf({ events: eventsOf([said('go'), stopped(), said('try again')]) })).toBe(
      EHeldAction.StartTurn,
    )
  })
})

const noticePosted = (): V2Body => ({
  type: 'input-posted',
  inboxId: 7,
  kind: 'event',
  postedAt: '2026-11-12T03:00:00.000Z',
  event: {
    type: 'sandbox-setup-reported',
    text: 'setup finished after 1.2s',
    failed: false,
    phase: ESetupPhase.Finished,
  },
})

describe('readHeldAction over a notice the drain has not reached', () => {
  it('starts a turn for a staged notice with no operator message', async () => {
    expect(await actionOf({ events: eventsOf([noticePosted()]) })).toBe(EHeldAction.StartTurn)
  })

  it('does not start another turn for a notice the drain already consumed', async () => {
    const events = eventsOf([
      noticePosted(),
      { type: 'input-consumed', inboxId: 7, consumed: EInputConsumed.Message },
    ])
    expect(await actionOf({ events })).toBe(EHeldAction.Wait)
  })
})

const said = (text: string): V2Body => ({ type: 'user-said', text })

const replied = (): V2Body => ({ type: 'assistant-said', parts: [] })

const shellEnded = (): V2Body => ({
  type: 'background-shell-ended',
  shellId: 'shell-1',
  command: 'bun run build',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

describe('readHeldAction over a shell ending that lands after the turn', () => {
  it('starts a turn for an ending the reply never saw', async () => {
    expect(await actionOf({ events: eventsOf([said('watch it'), replied(), shellEnded()]) })).toBe(
      EHeldAction.StartTurn,
    )
  })

  it('waits once the reply follows the ending', async () => {
    expect(
      await actionOf({
        events: eventsOf([said('watch it'), shellEnded(), replied()]),
      }),
    ).toBe(EHeldAction.Wait)
  })

  it('does not start another turn for an ending a turn already covered', async () => {
    const events = eventsOf([said('watch it'), replied(), shellEnded()])
    expect(await actionOf({ events, resumeAfterSeq: events.length })).toBe(EHeldAction.Wait)
  })
})
