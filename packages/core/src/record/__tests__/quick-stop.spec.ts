import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../agents/start'
import type { Assembled, AssembledMessage } from '../../assembly/assembled'
import { contextFor } from '../../assembly/__tests__/log-fixture'
import { messagesFromEvents } from '../../assembly/rules/messages-from-events'
import { EMessageOrigin } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toCallId, toThreadId } from '../../events/ids'
import { ERetryReason } from '../../models/retry'
import { chainEvents } from '../chain-events'
import { EInputConsumed, ERewindCause, v2EventSchema, type V2Body, type V2Event } from '../event'
import { visibleLoopEvents } from '../loop-events'
import { EResumePoint, RESUME_REFUSAL_NOTHING, resumePointOf } from '../resume-point'
import { quickStopOf, type QuickStopEnding } from '../quick-stop'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'
import { visibleEvents } from '../visibility'
import { NOW, runId, threadId } from './support'

const endedByOperator: QuickStopEnding = {
  outcome: ETurnOutcome.Stopped,
  by: ETurnEndedBy.Operator,
}

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const stopOf = (bodies: readonly V2Body[], ending: QuickStopEnding = endedByOperator) =>
  quickStopOf({ events: eventsOf(bodies), ending })

const said = (text: string, over: { via?: EMessageOrigin; clientId?: string } = {}): V2Body => ({
  type: 'user-said',
  text,
  ...over,
})

const thought = (text: string): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'reasoning', text }],
})

const replied = (text: string): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const started = (turnId = 'turn-1', cause = ETurnCause.Input): V2Body => ({
  type: 'turn-started',
  turnId,
  cause,
})

const ended = (
  turnId = 'turn-1',
  outcome = ETurnOutcome.Completed,
  by = ETurnEndedBy.Agent,
): V2Body => ({ type: 'turn-ended', turnId, outcome, by })

describe('quickStopOf', () => {
  it('rewinds a thinking-only stop to before the prompt', () => {
    const stop = stopOf([said('think hard about the meaning of life'), started(), thought('hm')])

    expect(stop).toEqual({ toSeq: 0, draft: 'think hard about the meaning of life' })
  })

  it('rewinds a thinking-only stop that came in through the inbox', () => {
    const posted: V2Body = {
      type: 'input-posted',
      inboxId: 4,
      kind: 'message',
      postedAt: '2026-11-24T20:00:00.000Z',
      message: { text: 'think hard', clientId: 'client-a' },
    }
    const stop = stopOf([posted, said('think hard'), started(), thought('hm')])

    expect(stop).toEqual({ toSeq: 1, draft: 'think hard' })
  })

  it('keeps the turn when reply text streamed', () => {
    expect(stopOf([said('explain it'), started(), replied('half a sentence')])).toBeNull()
  })

  it('keeps the turn when the model called a tool', () => {
    const called: V2Body = {
      type: 'tool-called',
      callId: toCallId('c1'),
      name: 'bash',
      input: {},
      ordinal: 0,
    }

    expect(stopOf([said('run the suite'), started(), called])).toBeNull()
  })

  it('keeps the turn when a sub-agent was spawned', () => {
    const spawned: V2Body = {
      type: 'agent-spawned',
      agentId: toThreadId('child-thread'),
      agentType: 'general-purpose',
      intent: 'audit the settings',
      mode: EAgentStart.Fresh,
    }

    expect(stopOf([said('audit the settings'), started(), spawned])).toBeNull()
  })

  it('keeps the turn when a message was drained mid-turn', () => {
    expect(stopOf([said('first thing'), started(), said('second thing')])).toBeNull()
  })

  it('keeps a resumed turn', () => {
    expect(
      stopOf([said('carry on'), started('turn-1', ETurnCause.Resume), thought('hm')]),
    ).toBeNull()
  })

  it('keeps a completed turn', () => {
    expect(
      stopOf([said('explain it'), started(), thought('hm')], {
        outcome: ETurnOutcome.Completed,
        by: ETurnEndedBy.Agent,
      }),
    ).toBeNull()
  })

  it('keeps a prompt that came from a routine', () => {
    expect(
      stopOf([said('nightly check', { via: EMessageOrigin.Routine }), started(), thought('hm')]),
    ).toBeNull()
  })

  it('keeps a turn whose prompts include one that is not from the operator', () => {
    expect(
      stopOf([
        said('think it over', { clientId: 'client-a' }),
        said('nightly check', { via: EMessageOrigin.Routine }),
        started(),
        thought('hm'),
      ]),
    ).toBeNull()
  })

  it('keeps a turn that did work before it started', () => {
    const called: V2Body = {
      type: 'tool-called',
      callId: toCallId('c1'),
      name: 'bash',
      input: {},
      ordinal: 0,
    }

    expect(stopOf([said('run the suite'), called, started()])).toBeNull()
  })

  it('keeps a turn that started twice', () => {
    expect(stopOf([said('go'), started(), started('turn-1'), thought('hm')])).toBeNull()
    expect(stopOf([said('go'), started(), thought('hm')])).not.toBeNull()
  })

  it('keeps a turn whose reply text was only whitespace', () => {
    expect(
      stopOf([
        said('explain it'),
        started(),
        { type: 'assistant-said', parts: [{ type: 'text', text: ' ' }] },
      ]),
    ).toBeNull()
  })

  it('keeps a turn with a resume mark in the hidden range', () => {
    expect(
      stopOf([
        said('go'),
        { type: 'resume-marked', point: EResumePoint.Clean, discards: [], callIds: [] },
        started(),
        thought('hm'),
      ]),
    ).toBeNull()
  })

  it('keeps a turn with no prompt of its own', () => {
    expect(stopOf([started(), thought('hm')])).toBeNull()
  })

  it('rewinds two queued prompts into one draft', () => {
    const stop = stopOf([said('first'), said('second'), started(), thought('hm')])

    expect(stop).toEqual({ toSeq: 0, draft: 'first\n\nsecond' })
  })

  it('takes only the prompts of the open turn', () => {
    const stop = stopOf([
      said('the first request'),
      started('turn-1'),
      replied('done'),
      ended('turn-1'),
      said('the second request'),
      started('turn-2'),
      thought('hm'),
    ])

    expect(stop).toEqual({ toSeq: 4, draft: 'the second request' })
  })

  it('tolerates bookkeeping and reasoning rows inside the turn', () => {
    const stop = stopOf([
      said('think it over'),
      started(),
      { type: 'input-consumed', inboxId: 1, consumed: EInputConsumed.Message },
      {
        type: 'retry-scheduled',
        key: 'model',
        notBefore: NOW,
        attempt: 1,
        reason: ERetryReason.Overloaded,
      },
      { type: 'fact-recorded', key: 'model', kind: 'routing' },
      thought('hm'),
    ])

    expect(stop).toEqual({ toSeq: 0, draft: 'think it over' })
  })
})

const EMPTY: Assembled = { system: [], messages: [] }

const assembledOf = (events: readonly Event[]): Assembled => {
  const ctx = contextFor({ events })
  return messagesFromEvents()(EMPTY, ctx)
}

const textOf = (entry: AssembledMessage): readonly string[] => {
  const parts = Array.isArray(entry.message.content)
    ? entry.message.content
    : [entry.message.content]
  return parts.flatMap((part) => (part.type === 'text' ? [part.text] : []))
}

const userTextsOf = (assembled: Assembled): readonly string[] =>
  assembled.messages
    .flatMap((entry) => (entry.message.role === 'user' ? [entry] : []))
    .flatMap(textOf)

const PROMPT = 'think hard about the meaning of life'

const bodies = (): readonly V2Body[] => [
  said(PROMPT, { clientId: 'client-a' }),
  started(),
  thought('hm'),
]

const rewound = (): V2Event[] => {
  const stop = stopOf(bodies())
  if (stop === null) throw new Error('expected a quick stop')
  return eventsOf([
    ...bodies(),
    ended('turn-1', ETurnOutcome.Stopped, ETurnEndedBy.Operator),
    {
      type: 'history-rewound',
      toSeq: stop.toSeq,
      draft: stop.draft,
      cause: ERewindCause.QuickStop,
    },
  ])
}

describe('a quick stop in the log', () => {
  it('leaves no stopped turn to resume', () => {
    expect(resumePointOf({ events: rewound() })).toEqual({
      kind: EResumePoint.NotResumable,
      because: RESUME_REFUSAL_NOTHING,
    })
  })

  it('hides the prompt and the cut turn from every view', () => {
    const visible = visibleEvents(rewound())

    expect(visible.some((event) => event.type === 'user-said')).toBe(false)
    expect(visible.some((event) => event.type === 'turn-ended')).toBe(false)
  })

  it('keeps the prompt out of the assembled messages', () => {
    const assembled = assembledOf(visibleLoopEvents(rewound()))

    expect(userTextsOf(assembled)).toEqual([])
  })

  it('parses a rewind with a cause, and one without', () => {
    const [quickStop] = rewound().slice(-1)
    const marked = v2EventSchema.safeParse(quickStop)
    const operator = v2EventSchema.safeParse({
      ...(quickStop as V2Event),
      cause: undefined,
    })

    expect(marked.success).toBe(true)
    expect(marked.data?.type === 'history-rewound' ? marked.data.cause : undefined).toBe(
      ERewindCause.QuickStop,
    )
    expect(
      operator.data?.type === 'history-rewound' ? operator.data.cause : 'missing',
    ).toBeUndefined()
  })
})
