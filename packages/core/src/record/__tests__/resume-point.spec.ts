import { describe, expect, it } from 'bun:test'

import { contextFor, log } from '../../assembly/__tests__/log-fixture'
import type { Assembled, AssembledMessage } from '../../assembly/assembled'
import { messagesFromEvents } from '../../assembly/rules/messages-from-events'
import { ECompactionAnchor, type EventDraft } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toCallId } from '../../events/ids'
import {
  APPROVAL_WAITING,
  RESUME_AFTER_INTERRUPTED_TOOL,
  TOOL_PARKED_WAITING,
} from '../../events/resume-plan'
import { chainEvents } from '../chain-events'
import { recordEventSchema, type RecordEventBody, type RecordEvent } from '../event'
import { isResumableOf, loopStateOf } from '../loop-state'
import { visibleLoopEvents } from '../loop-events'
import {
  EResumePoint,
  RESUME_REFUSAL_ALREADY,
  RESUME_REFUSAL_FAILED,
  RESUME_REFUSAL_FINISHED,
  RESUME_REFUSAL_MESSAGE,
  RESUME_REFUSAL_NOTHING,
  RESUME_REFUSAL_RUNNING,
  type ResumeDiscard,
  resumableOf,
  resumePointOf,
} from '../resume-point'
import { ETurnCause, ETurnEndedBy, ETurnOutcome, openTurnOf } from '../turns'
import { visibleEvents } from '../visibility'
import { REWIND_MID_TURN_ROWS } from './rewind-mid-turn-fixture'
import { NOW, runId, threadId } from './support'

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

const replied = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const cutReply = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
  interrupted: true,
  stopped: true,
})

const called = (params: { id: string; name?: string }): RecordEventBody => ({
  type: 'tool-called',
  callId: toCallId(params.id),
  name: params.name ?? 'bash',
  input: {},
  ordinal: 0,
})

const answered = (params: { id: string; interrupted?: boolean }): RecordEventBody => ({
  type: 'tool-result',
  callId: toCallId(params.id),
  name: 'bash',
  output: 'done',
  ...(params.interrupted === true ? { interrupted: true } : {}),
})

const started = (turnId = 'turn-1', cause = ETurnCause.Input): RecordEventBody => ({
  type: 'turn-started',
  turnId,
  cause,
})

const ended = (outcome: ETurnOutcome, by = ETurnEndedBy.Operator): RecordEventBody => ({
  type: 'turn-ended',
  turnId: 'turn-1',
  outcome,
  by,
})

const cleanResume = (discards: readonly ResumeDiscard[] = []): RecordEventBody => ({
  type: 'resume-marked',
  point: EResumePoint.Clean,
  discards: [...discards],
  callIds: [],
})

const pointOf = (bodies: readonly RecordEventBody[]) => resumePointOf({ events: eventsOf(bodies) })

describe('resumePointOf', () => {
  it('row 1: a stop while streaming text discards the cut reply', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
    ])

    expect(point).toEqual({ kind: EResumePoint.Clean, discard: { fromSeq: 3, throughSeq: 3 } })
  })

  it('row 2: a stop before anything arrived discards nothing', () => {
    const point = pointOf([said('run the suite'), started(), ended(ETurnOutcome.Stopped)])

    expect(point).toEqual({ kind: EResumePoint.Clean, discard: null })
  })

  it('row 3: a stop between steps discards nothing', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      replied('the first step is done'),
      ended(ETurnOutcome.Stopped),
    ])

    expect(point).toEqual({ kind: EResumePoint.Clean, discard: null })
  })

  it('row 4: a stop during one tool names that call', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('running it'),
      called({ id: 'c1' }),
      answered({ id: 'c1', interrupted: true }),
      ended(ETurnOutcome.Stopped),
    ])

    expect(point).toEqual({ kind: EResumePoint.ToolInterrupted, callIds: ['c1'] })
  })

  it('row 5: a stop during parallel tools names only the interrupted calls', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('running three'),
      called({ id: 'c1' }),
      called({ id: 'c2' }),
      called({ id: 'c3' }),
      answered({ id: 'c1' }),
      answered({ id: 'c2', interrupted: true }),
      answered({ id: 'c3', interrupted: true }),
      ended(ETurnOutcome.Stopped),
    ])

    expect(point).toEqual({ kind: EResumePoint.ToolInterrupted, callIds: ['c2', 'c3'] })
  })

  it('row 6: a stop during a sub-agent call names the parent call, and the child decides alone', () => {
    const parent = pointOf([
      said('delegate the audit'),
      started(),
      cutReply('spawning it'),
      called({ id: 'c1', name: 'agent' }),
      answered({ id: 'c1', interrupted: true }),
      ended(ETurnOutcome.Stopped),
    ])
    const child = pointOf([said('audit the settings'), started(), ended(ETurnOutcome.Stopped)])

    expect(parent).toEqual({ kind: EResumePoint.ToolInterrupted, callIds: ['c1'] })
    expect(child).toEqual({ kind: EResumePoint.Clean, discard: null })
  })

  it('row 7: a message after the stop ends resumability', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      said('carry on differently'),
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_MESSAGE })
  })

  it('row 8: a rewind past the stop ends resumability', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      { type: 'history-rewound', toSeq: 1 },
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_NOTHING })
  })

  it('resumes the stopped turn after a rewind landed inside an earlier turn', () => {
    const events = eventsOf([
      said('read the repo'),
      started('turn-1'),
      said('list the files in the repo root, then stop'),
      replied('I read the repo root'),
      {
        type: 'turn-ended',
        turnId: 'turn-1',
        outcome: ETurnOutcome.Completed,
        by: ETurnEndedBy.Agent,
      },
      started('turn-2'),
      cutReply('half a sentence'),
      {
        type: 'turn-ended',
        turnId: 'turn-2',
        outcome: ETurnOutcome.Stopped,
        by: ETurnEndedBy.Operator,
      },
      { type: 'history-rewound', toSeq: 3 },
      started('turn-3'),
      replied('listed it'),
      {
        type: 'turn-ended',
        turnId: 'turn-3',
        outcome: ETurnOutcome.Completed,
        by: ETurnEndedBy.Agent,
      },
      started('turn-4'),
      cutReply('the tail of a sentence'),
      {
        type: 'turn-ended',
        turnId: 'turn-4',
        outcome: ETurnOutcome.Stopped,
        by: ETurnEndedBy.Operator,
      },
    ])

    expect(openTurnOf(visibleEvents(events))).toBeNull()
    expect(resumePointOf({ events })).toEqual({
      kind: EResumePoint.Clean,
      discard: { fromSeq: 14, throughSeq: 14 },
    })
  })

  it('reads the same answer from the recorded session 4ca7d5a5', () => {
    const events = REWIND_MID_TURN_ROWS.map((row) => recordEventSchema.parse(row))

    expect(openTurnOf(visibleEvents(events))).toBeNull()
    expect(resumePointOf({ events })).toEqual({
      kind: EResumePoint.Clean,
      discard: { fromSeq: 66, throughSeq: 66 },
    })
  })

  it('row 9: a summary over the stop ends resumability', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      {
        type: 'history-summarised',
        fromSeq: 1,
        throughSeq: 4,
        anchor: ECompactionAnchor.Prefix,
        summary: 'they asked for the suite and it was stopped',
      },
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_NOTHING })
  })

  it('row 10: a rotation after the stop does not end resumability', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      { type: 'rotated', handoff: 'the plan and the branch' },
    ])

    expect(point).toEqual({ kind: EResumePoint.Clean, discard: { fromSeq: 3, throughSeq: 3 } })
  })

  it('row 11: a completed turn is not resumable', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      replied('all green'),
      ended(ETurnOutcome.Completed, ETurnEndedBy.Agent),
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_FINISHED })
  })

  it('row 12: a failed turn names retry, not resume', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      ended(ETurnOutcome.Failed, ETurnEndedBy.Host),
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_FAILED })
  })

  it('row 13: a resumed turn does not resume twice', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      cleanResume([{ fromSeq: 3, throughSeq: 3 }]),
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_ALREADY })
  })

  it('row 14: a running turn refuses a resume', () => {
    expect(pointOf([said('run the suite'), started()])).toEqual({
      kind: EResumePoint.NotResumable,
      because: RESUME_REFUSAL_RUNNING,
    })

    const resumedAndRunning = pointOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      cleanResume([{ fromSeq: 3, throughSeq: 3 }]),
      started('turn-1', ETurnCause.Resume),
    ])

    expect(resumedAndRunning).toEqual({
      kind: EResumePoint.NotResumable,
      because: RESUME_REFUSAL_RUNNING,
    })
  })

  it('refuses while an approval is outstanding', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('running it'),
      ended(ETurnOutcome.Stopped),
      { type: 'approval-requested', callId: toCallId('c1'), reason: 'destructive' },
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: APPROVAL_WAITING })
  })

  it('refuses while a call is parked', () => {
    const point = pointOf([
      said('run the suite'),
      started(),
      cutReply('running it'),
      { type: 'tool-parked', callId: toCallId('c1'), name: 'bash' },
      ended(ETurnOutcome.Stopped),
    ])

    expect(point).toEqual({ kind: EResumePoint.NotResumable, because: TOOL_PARKED_WAITING })
  })

  it('refuses an empty thread', () => {
    expect(resumePointOf({ events: [] })).toEqual({
      kind: EResumePoint.NotResumable,
      because: RESUME_REFUSAL_NOTHING,
    })
  })
})

describe('resumableOf', () => {
  it('is true for a clean point and a tool-interrupted one', () => {
    expect(resumableOf({ kind: EResumePoint.Clean, discard: null })).toBe(true)
    expect(resumableOf({ kind: EResumePoint.ToolInterrupted, callIds: ['c1'] })).toBe(true)
  })

  it('is false for every refusal', () => {
    expect(resumableOf({ kind: EResumePoint.NotResumable, because: RESUME_REFUSAL_RUNNING })).toBe(
      false,
    )
  })
})

describe('the automatic resume path', () => {
  const stopped = [
    said('run the suite'),
    started(),
    cutReply('half a sentence'),
    ended(ETurnOutcome.Stopped),
  ]
  const stoppedEvents = () => eventsOf(stopped)

  it('stays off while the operator stop is the last prompt', () => {
    expect(isResumableOf(loopStateOf({ events: visibleLoopEvents(stoppedEvents()) }))).toBe(false)
  })

  it('opens once the marker is the last prompt', () => {
    const resumed = eventsOf([...stopped, cleanResume([{ fromSeq: 3, throughSeq: 3 }])])

    expect(isResumableOf(loopStateOf({ events: visibleLoopEvents(resumed) }))).toBe(true)
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

const rolesOf = (assembled: Assembled): readonly string[] =>
  assembled.messages.map((entry) => entry.message.role)

const STOP_NOTICE = 'The operator stopped your previous reply here.'

const stoppedTurn: readonly EventDraft[] = [
  { type: 'user-said', text: 'run the suite' },
  {
    type: 'assistant-said',
    parts: [{ type: 'text', text: 'half a sentence' }],
    interrupted: true,
    stopped: true,
  },
  { type: 'tool-called', callId: toCallId('c1'), name: 'bash', input: {}, ordinal: 0 },
  {
    type: 'tool-denied',
    callId: toCallId('c1'),
    name: 'bash',
    reason: 'the turn was stopped',
    interrupted: true,
  },
]

const markerDraft = (marker: {
  point: EResumePoint.Clean | EResumePoint.ToolInterrupted
  discards?: readonly ResumeDiscard[]
  callIds?: readonly string[]
}): EventDraft => ({
  type: 'resume-marked',
  point: marker.point,
  discards: [...(marker.discards ?? [])],
  callIds: [...(marker.callIds ?? [])],
})

describe('the discard in the model context', () => {
  const resumedDrafts: readonly EventDraft[] = [
    ...stoppedTurn,
    markerDraft({ point: EResumePoint.Clean, discards: [{ fromSeq: 2, throughSeq: 4 }] }),
  ]

  it('hides the cut reply, its calls and the operator-stop notice', () => {
    const resumed = assembledOf(log(resumedDrafts))

    expect(rolesOf(resumed)).toEqual(['user'])
    expect(userTextsOf(resumed).length).toBe(1)
    expect(userTextsOf(resumed)[0]).toContain('run the suite')
  })

  it('reads exactly as the same log without the cut step', () => {
    const resumed = assembledOf(log(resumedDrafts))
    const neverCut = assembledOf(log([{ type: 'user-said', text: 'run the suite' }]))

    expect(resumed.messages).toEqual(neverCut.messages)
  })

  it('keeps the operator-stop notice when no marker covers the row', () => {
    const texts = userTextsOf(assembledOf(log(stoppedTurn)))

    expect(texts.some((text) => text.includes(STOP_NOTICE))).toBe(true)
  })

  it('adds one sentence, and no discard, when a tool was interrupted', () => {
    const interrupted = assembledOf(
      log([
        { type: 'user-said', text: 'run the suite' },
        {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'half a sentence' }],
          interrupted: true,
          stopped: true,
        },
        { type: 'tool-called', callId: toCallId('c1'), name: 'bash', input: {}, ordinal: 0 },
        {
          type: 'tool-result',
          callId: toCallId('c1'),
          name: 'bash',
          output: 'killed with the turn',
          interrupted: true,
        },
        markerDraft({ point: EResumePoint.ToolInterrupted, callIds: ['c1'] }),
      ]),
    )
    const texts = userTextsOf(interrupted)

    expect(texts.filter((text) => text.includes(RESUME_AFTER_INTERRUPTED_TOOL)).length).toBe(1)
    expect(texts.some((text) => text.includes(STOP_NOTICE))).toBe(true)
    expect(rolesOf(interrupted)).toEqual(['user', 'assistant', 'tool', 'user', 'user'])
  })

  it('stops discarding when a later rewind hides the marker', () => {
    const rewound = eventsOf([
      said('run the suite'),
      started(),
      cutReply('half a sentence'),
      ended(ETurnOutcome.Stopped),
      cleanResume([{ fromSeq: 3, throughSeq: 3 }]),
      { type: 'history-rewound', toSeq: 3 },
    ])
    const texts = userTextsOf(assembledOf(visibleLoopEvents(rewound)))

    expect(texts.some((text) => text.includes(STOP_NOTICE))).toBe(true)
  })
})
