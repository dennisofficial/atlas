import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '../../agents/status'
import { toCallId, toThreadId } from '../../events/ids'
import { chainEvents } from '../chain-events'
import type { V2Body, V2Event } from '../event'
import { EInputKind, commandInputKind } from '../input-events'
import {
  EMPTY_PENDING,
  pendingInputsOf,
  pendingMessagesOf,
  pendingNoticesOf,
  queuedSinceOf,
  queuedSinceOfInbox,
  stepPending,
} from '../pending-inputs'
import { initialStatusFacts, stepStatusFacts } from '../views/status-facts'
import { deriveStatus } from '../views/derive-status'
import { ETurnCause } from '../turns'
import { ESessionStatus } from '../views/status-types'
import { mint, NOW, runId, threadId } from './support'

const EARLIER = '2026-11-02T11:59:00.000Z'
const LATER = '2026-11-02T12:00:30.000Z'

const log = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({ threadId, runId, epoch: 3, at: NOW, bodies })

const posted = (args: {
  inboxId: number
  kind?: string
  text?: string
  clientId?: string
  postedAt?: string
}): V2Body => ({
  type: 'input-posted',
  inboxId: args.inboxId,
  kind: args.kind ?? EInputKind.Message,
  postedAt: args.postedAt ?? NOW,
  ...(args.text === undefined ? {} : { text: args.text }),
  ...(args.clientId === undefined ? {} : { clientId: args.clientId }),
})

const said = (args: { inboxId?: number; text?: string }): V2Body => ({
  type: 'user-said',
  text: args.text ?? 'hello',
  ...(args.inboxId === undefined ? {} : { inboxId: args.inboxId }),
})

const message = (text: string): V2Body => said({ text })

const turnStarted: V2Body = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }

describe('stepPending', () => {
  it('drops a posted message once user-said carries its inboxId', () => {
    const state = pendingInputsOf(
      log([posted({ inboxId: 1, text: 'ship it' }), said({ inboxId: 1 })]),
    )
    expect(state).toEqual(EMPTY_PENDING)
  })

  it('keeps a posted message pending when user-said carries no inboxId', () => {
    const state = pendingInputsOf(log([posted({ inboxId: 1 }), message('unrelated')]))
    expect(pendingMessagesOf(state).map((entry) => entry.inboxId)).toEqual([1])
  })

  it('drops a withdrawn input', () => {
    const state = pendingInputsOf(
      log([posted({ inboxId: 7 }), { type: 'input-withdrawn', inboxId: 7 }]),
    )
    expect(pendingMessagesOf(state)).toEqual([])
    expect(queuedSinceOf(state)).toBeNull()
  })

  it('keeps post and said from one commit empty at every prefix', () => {
    const events = log([posted({ inboxId: 2, text: 'x' }), said({ inboxId: 2 })])
    const afterPost = events.slice(0, 1).reduce(stepPending, EMPTY_PENDING)
    expect(pendingMessagesOf(afterPost).map((entry) => entry.inboxId)).toEqual([2])
    expect(events.reduce(stepPending, EMPTY_PENDING)).toEqual(EMPTY_PENDING)
  })

  it('drops a refused input and the input a refusal names as its target', () => {
    const refused = pendingInputsOf(
      log([
        posted({ inboxId: 3 }),
        posted({ inboxId: 4 }),
        { type: 'input-refused', inboxId: 3, reason: 'unknown' },
      ]),
    )
    expect(pendingMessagesOf(refused).map((entry) => entry.inboxId)).toEqual([4])

    const targeted = pendingInputsOf(
      log([
        posted({ inboxId: 5 }),
        { type: 'input-refused', inboxId: 9, reason: 'already-sent', targetInboxId: 5 },
      ]),
    )
    expect(pendingMessagesOf(targeted)).toEqual([])
  })

  it('drops an input consumed by the old record body', () => {
    const state = pendingInputsOf(
      log([posted({ inboxId: 6 }), { type: 'input-consumed', inboxId: 6 }]),
    )
    expect(pendingMessagesOf(state)).toEqual([])
  })

  it('keeps stop and command inputs out of pendingMessagesOf yet drops them when consumed', () => {
    const stop = posted({ inboxId: 8, kind: EInputKind.Stop })
    const command = posted({ inboxId: 9, kind: commandInputKind('compact') })
    const state = pendingInputsOf(log([stop, command]))
    expect(pendingMessagesOf(state)).toEqual([])
    expect(queuedSinceOf(state)).toBeNull()
    expect(state.pending.map((entry) => entry.kind)).toEqual(['stop', 'command:compact'])

    const consumed = pendingInputsOf(log([command, { type: 'input-consumed', inboxId: 9 }]))
    expect(consumed.pending).toEqual([])
  })

  it('orders pending inputs by seq, not by arrival of the drain', () => {
    const events = log([
      posted({ inboxId: 1, text: 'first', postedAt: EARLIER }),
      posted({ inboxId: 2, text: 'second', postedAt: LATER }),
      posted({ inboxId: 3, text: 'third' }),
      said({ inboxId: 2 }),
    ])
    expect(pendingMessagesOf(pendingInputsOf(events)).map((entry) => entry.message?.text)).toEqual([
      'first',
      'third',
    ])
  })

  it('keeps the clientId and the posted time on a pending input', () => {
    const [entry] = pendingMessagesOf(
      pendingInputsOf(
        log([posted({ inboxId: 4, text: 'four', clientId: 'c-1', postedAt: EARLIER })]),
      ),
    )
    expect(entry).toMatchObject({ message: { clientId: 'c-1' }, at: EARLIER, seq: 1 })
  })

  it('folds the whole log the same as it folds it in chunks', () => {
    const events = log([
      posted({ inboxId: 1 }),
      posted({ inboxId: 2 }),
      said({ inboxId: 1 }),
      message('a turn'),
      posted({ inboxId: 3 }),
      { type: 'input-withdrawn', inboxId: 3 },
      posted({ inboxId: 4 }),
    ])
    const whole = pendingInputsOf(events)
    const chunked = [events.slice(0, 2), events.slice(2, 5), events.slice(5)].reduce(
      (state, chunk) => chunk.reduce(stepPending, state),
      EMPTY_PENDING,
    )
    expect(chunked).toEqual(whole)
    expect(JSON.parse(JSON.stringify(whole))).toEqual(whole)
  })

  it('ignores events that are not about inputs', () => {
    const [plain] = mint({ count: 1 })
    expect(stepPending(EMPTY_PENDING, plain as V2Event)).toBe(EMPTY_PENDING)
  })
})

describe('pendingNoticesOf', () => {
  const ended = {
    type: 'agent-ended' as const,
    agentId: toThreadId('agent-1'),
    agentType: 'general-purpose',
    intent: 'look around',
    status: EAgentStatus.Finished,
    prose: 'done',
    turns: 1,
    toolCalls: 3,
  }

  it('keeps the event a notice arrived with and leaves it out of the messages', () => {
    const state = pendingInputsOf(
      log([{ type: 'input-posted', inboxId: 11, kind: 'event', postedAt: NOW, event: ended }]),
    )
    expect(pendingMessagesOf(state)).toEqual([])
    expect(pendingNoticesOf(state)).toMatchObject([
      { inboxId: 11, kind: 'event', event: { type: 'agent-ended', agentId: 'agent-1' } },
    ])
  })

  it('drops a notice once the drain consumes it', () => {
    const state = pendingInputsOf(
      log([
        { type: 'input-posted', inboxId: 12, kind: 'event', postedAt: NOW, event: ended },
        { type: 'input-consumed', inboxId: 12 },
      ]),
    )
    expect(pendingNoticesOf(state)).toEqual([])
  })
})

describe('queuedSinceOf', () => {
  it('dates the queue from the message at its head', () => {
    const state = pendingInputsOf(
      log([posted({ inboxId: 1, postedAt: LATER }), posted({ inboxId: 2, postedAt: EARLIER })]),
    )
    expect(queuedSinceOf(state)).toBe(LATER)
  })
})

describe('queuedSinceOfInbox', () => {
  it('dates the queue from the oldest message the log never posted', () => {
    expect(
      queuedSinceOfInbox([
        { kind: EInputKind.Message, postedAt: LATER, consumedSeq: null },
        { kind: EInputKind.Message, postedAt: EARLIER, consumedSeq: null },
      ]),
    ).toBe(EARLIER)
  })

  it('ignores consumed rows, commands and notices', () => {
    expect(
      queuedSinceOfInbox([
        { kind: EInputKind.Message, postedAt: EARLIER, consumedSeq: 12 },
        { kind: commandInputKind('summarise'), postedAt: EARLIER, consumedSeq: null },
        { kind: 'event', postedAt: EARLIER, consumedSeq: null },
      ]),
    ).toBeNull()
  })
})

describe('status from the pending fold', () => {
  const status = (args: {
    events: readonly V2Event[]
    pending?: boolean
    queuedSince?: string | null
  }): ReturnType<typeof deriveStatus> =>
    deriveStatus({
      facts: args.events.reduce(stepStatusFacts, initialStatusFacts),
      live: true,
      queuedSince: args.queuedSince ?? null,
      ...(args.pending === false ? {} : { pending: pendingInputsOf(args.events) }),
      now: NOW,
    })

  it('reports queued since the posted time while a message waits', () => {
    const events = log([posted({ inboxId: 1, postedAt: EARLIER })])
    expect(status({ events })).toEqual({ state: ESessionStatus.Queued, since: EARLIER })
  })

  it('leaves queued once the message is drained into user-said', () => {
    const events = log([
      turnStarted,
      posted({ inboxId: 1, postedAt: EARLIER }),
      said({ inboxId: 1 }),
    ])
    expect(status({ events }).state).toBe(ESessionStatus.Thinking)
  })

  it('lets the fold outrank a staging queue time and fall back to it when the fold is empty', () => {
    const events = log([posted({ inboxId: 1, postedAt: EARLIER })])
    expect(status({ events, queuedSince: LATER })).toEqual({
      state: ESessionStatus.Queued,
      since: EARLIER,
    })
    expect(status({ events: log([message('hi')]), queuedSince: LATER })).toEqual({
      state: ESessionStatus.Queued,
      since: LATER,
    })
  })

  it('reports the running turn, not queued, while a message waits', () => {
    const running: V2Body[] = [
      turnStarted,
      { type: 'tool-dispatched', callId: toCallId('call-1'), name: 'bash' },
    ]
    const queued = log([...running, posted({ inboxId: 1, postedAt: EARLIER })])
    expect(status({ events: queued })).toEqual({
      state: ESessionStatus.RunningTool,
      reason: 'bash',
      since: NOW,
    })
    expect(
      status({ events: log([...running, posted({ inboxId: 1 }), said({ inboxId: 1 })]) }),
    ).toEqual({ state: ESessionStatus.Thinking, since: NOW })
  })
})
