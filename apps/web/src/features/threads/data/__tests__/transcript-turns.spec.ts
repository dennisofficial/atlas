import { describe, expect, it } from 'bun:test'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { ENoticeTone, ETranscriptKind, type TranscriptItem } from '../transcript-items'
import { ESegmentKind, ETurnKind, turnsOf, type AgentTurn, type Segment } from '../transcript-turns'

const user = (id: string, at?: string): TranscriptItem => ({
  kind: ETranscriptKind.User,
  id,
  text: id,
  ...(at === undefined ? {} : { at }),
})
const agent = (id: string, at?: string, streaming = false): TranscriptItem => ({
  kind: ETranscriptKind.Agent,
  id,
  text: id,
  streaming,
  ...(at === undefined ? {} : { at }),
})
const thought = (id: string, at?: string): TranscriptItem => ({
  kind: ETranscriptKind.Thought,
  id,
  text: id,
  streaming: false,
  heldOpen: false,
  ...(at === undefined ? {} : { at }),
})
const tools = (id: string, count: number, at?: string): TranscriptItem => ({
  kind: ETranscriptKind.Tools,
  id,
  calls: Array.from({ length: count }, (_, index) => ({
    id: `${id}-${index}`,
    kind: EToolKind.Shell,
    state: EToolState.Done,
    label: 'ls',
  })),
  ...(at === undefined ? {} : { at }),
})

const agentTurns = (turns: ReturnType<typeof turnsOf>): AgentTurn[] =>
  turns.flatMap((turn) => (turn.kind === ETurnKind.Agent ? [turn] : []))

const shapeOf = (segments: readonly Segment[] | undefined): string[] =>
  (segments ?? []).map((segment) =>
    segment.kind === ESegmentKind.Message
      ? `message:${segment.item.id}`
      : `work:${segment.items.map((item) => item.id).join(',')}`,
  )

describe('agent messages are never grouped into work', () => {
  it('renders an interim message between the work groups it separates', () => {
    const [turn] = agentTurnsOf([
      user('u1', 't0'),
      tools('tl1', 2, 't1'),
      agent('a1', 't2'),
      tools('tl2', 1, 't3'),
      thought('th1', 't4'),
      agent('a2', 't5'),
    ])
    expect(shapeOf(turn?.segments)).toEqual([
      'work:tl1',
      'message:a1',
      'work:tl2,th1',
      'message:a2',
    ])
  })

  it('times each work group from the message before it', () => {
    const [turn] = agentTurnsOf([
      user('u1', 't0'),
      tools('tl1', 2, 't1'),
      agent('a1', 't2'),
      tools('tl2', 1, 't3'),
    ])
    const work = turn?.segments.filter((segment) => segment.kind === ESegmentKind.Work)
    expect(work).toMatchObject([
      { startedAt: 't0', endedAt: 't2', stepCount: 2 },
      { startedAt: 't2', endedAt: 't3', stepCount: 1 },
    ])
  })

  it('marks only the final message as the answer', () => {
    const [turn] = agentTurnsOf([user('u1'), agent('a1'), tools('tl1', 1), agent('a2')])
    const finals = turn?.segments.flatMap((segment) =>
      segment.kind === ESegmentKind.Message ? [segment.final] : [],
    )
    expect(finals).toEqual([false, true])
  })
})

describe('turnsOf', () => {
  it('splits the trailing agent message from the work before it', () => {
    const turns = turnsOf({
      items: [user('u1', 't0'), thought('th1', 't1'), tools('tl1', 2, 't2'), agent('a1', 't3')],
      working: false,
    })
    expect(turns.map((turn) => turn.kind)).toEqual([ETurnKind.User, ETurnKind.Agent])
    const [turn] = agentTurns(turns)
    expect(shapeOf(turn?.segments)).toEqual(['work:th1,tl1', 'message:a1'])
    expect(turn?.segments[0]).toMatchObject({
      stepCount: 3,
      startedAt: 't0',
      endedAt: 't3',
      running: false,
    })
  })

  it('ends on a work group when the run ends on work', () => {
    const [turn] = agentTurnsOf([user('u1'), tools('tl1', 1)])
    expect(shapeOf(turn?.segments)).toEqual(['work:tl1'])
  })

  it('starts a work group at its preceding user message and falls back to its first item', () => {
    const turns = agentTurns(
      turnsOf({
        items: [tools('tl0', 1, 'x1'), user('u1', 'x2'), tools('tl1', 1, 'x3')],
        working: false,
      }),
    )
    expect(turns.map((turn) => turn.segments[0])).toMatchObject([
      { startedAt: 'x1' },
      { startedAt: 'x2' },
    ])
  })

  it('splits one agent turn per user message', () => {
    const turns = turnsOf({
      items: [user('u1'), agent('a1'), user('u2'), agent('a2')],
      working: false,
    })
    expect(turns.map((turn) => turn.kind)).toEqual([
      ETurnKind.User,
      ETurnKind.Agent,
      ETurnKind.User,
      ETurnKind.Agent,
    ])
  })

  it('marks only the last turn as running while working', () => {
    const turns = agentTurns(
      turnsOf({
        items: [user('u1'), agent('a1'), user('u2'), tools('tl1', 1)],
        working: true,
      }),
    )
    expect(turns.map((turn) => turn.running)).toEqual([false, true])
  })

  it('adds an empty running turn when the tail is a user message', () => {
    const turns = turnsOf({ items: [user('u1', 't0')], working: true })
    expect(turns.map((turn) => turn.kind)).toEqual([ETurnKind.User, ETurnKind.Agent])
    expect(agentTurns(turns)[0]?.segments).toMatchObject([
      { kind: ESegmentKind.Work, items: [], stepCount: 0, running: true, startedAt: 't0' },
    ])
  })

  it('adds nothing for a user-only tail when idle', () => {
    expect(turnsOf({ items: [user('u1')], working: false })).toHaveLength(1)
  })

  it('shows a streaming message without a running work group after it', () => {
    const [turn] = agentTurnsOf([user('u1'), thought('th1'), agent('a1', undefined, true)], true)
    expect(shapeOf(turn?.segments)).toEqual(['work:th1', 'message:a1'])
  })

  it('opens a running work group after a finished message while working', () => {
    const [turn] = agentTurnsOf([user('u1'), agent('a1', 't1')], true)
    expect(turn?.segments.at(-1)).toMatchObject({
      kind: ESegmentKind.Work,
      running: true,
      startedAt: 't1',
    })
  })

  it('keeps a work group id stable as it gains items', () => {
    const before = agentTurnsOf([user('u1')], true)
    const after = agentTurnsOf([user('u1'), tools('tl1', 1)], true)
    expect(after[0]?.segments[0]?.id).toBe(before[0]?.segments[0]?.id)
  })

  it('keeps a turn id stable as the turn gains items', () => {
    const before = agentTurnsOf([user('u1')], true)
    const after = agentTurnsOf([user('u1'), tools('tl1', 1), agent('a1')], true)
    expect(after[0]?.id).toBe(before[0]?.id)
  })
})

function agentTurnsOf(items: TranscriptItem[], working = false): AgentTurn[] {
  return agentTurns(turnsOf({ items, working }))
}

const notice = (id: string, at?: string): TranscriptItem => ({
  kind: ETranscriptKind.Notice,
  id,
  title: id,
  body: '',
  tone: ENoticeTone.Quiet,
  ...(at === undefined ? {} : { at }),
})

describe('work duration', () => {
  const callAt = (index: number, at: string, settledAt: string) => ({
    id: `c${index}`,
    kind: EToolKind.Shell,
    state: EToolState.Done,
    label: 'ls',
    at,
    settledAt,
  })

  it('ends a settled run at its last call settling, not at its first call starting', () => {
    const [turn] = agentTurnsOf([
      user('u1', '2026-10-29T06:21:23.000Z'),
      {
        kind: ETranscriptKind.Tools,
        id: 'tl1',
        at: '2026-10-29T06:21:57.000Z',
        calls: [
          callAt(0, '2026-10-29T06:21:57.000Z', '2026-10-29T06:21:57.200Z'),
          callAt(1, '2026-10-29T06:23:30.000Z', '2026-10-29T06:23:31.000Z'),
        ],
      },
    ])
    expect(turn?.segments[0]).toMatchObject({
      startedAt: '2026-10-29T06:21:23.000Z',
      endedAt: '2026-10-29T06:23:31.000Z',
    })
  })

  it('counts the time spent writing the message that follows the work', () => {
    const [turn] = agentTurnsOf([
      user('u1', '2026-10-29T06:00:00.000Z'),
      tools('tl1', 1, '2026-10-29T06:00:10.000Z'),
      agent('a1', '2026-10-29T06:01:00.000Z'),
    ])
    expect(turn?.segments[0]).toMatchObject({ endedAt: '2026-10-29T06:01:00.000Z' })
  })
})

describe('harness notices', () => {
  it('closes the run and starts the next agent turn at the notice time', () => {
    const turns = turnsOf({
      items: [
        user('u1', '2026-10-28T10:00:00.000Z'),
        agent('a1', '2026-10-28T10:00:05.000Z'),
        notice('n1', '2026-10-28T10:01:00.000Z'),
        tools('tl1', 1, '2026-10-28T10:01:10.000Z'),
        agent('a2', '2026-10-28T10:01:20.000Z'),
      ],
      working: false,
    })

    expect(turns.map((turn) => turn.kind)).toEqual([
      ETurnKind.User,
      ETurnKind.Agent,
      ETurnKind.Notice,
      ETurnKind.Agent,
    ])
    const woken = turns[3]
    const work = woken?.kind === ETurnKind.Agent ? woken.segments[0] : undefined
    expect(work?.kind === ESegmentKind.Work ? work.startedAt : undefined).toBe(
      '2026-10-28T10:01:00.000Z',
    )
  })

  it('awaits a reply after a trailing notice while working', () => {
    const turns = turnsOf({ items: [notice('n1', 't1')], working: true })

    expect(turns.map((turn) => turn.kind)).toEqual([ETurnKind.Notice, ETurnKind.Agent])
  })
})
