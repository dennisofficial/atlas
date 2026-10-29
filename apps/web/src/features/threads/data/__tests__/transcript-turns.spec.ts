import { describe, expect, it } from 'bun:test'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { ETranscriptKind, type TranscriptItem } from '../transcript-items'
import { ETurnKind, turnsOf, type AgentTurn } from '../transcript-turns'

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

describe('turnsOf', () => {
  it('splits the trailing agent message from the work before it', () => {
    const turns = turnsOf({
      items: [user('u1', 't0'), thought('th1', 't1'), tools('tl1', 2, 't2'), agent('a1', 't3')],
      working: false,
    })
    expect(turns.map((turn) => turn.kind)).toEqual([ETurnKind.User, ETurnKind.Agent])
    const [turn] = agentTurns(turns)
    expect(turn?.work.map((item) => item.id)).toEqual(['th1', 'tl1'])
    expect(turn?.answer?.id).toBe('a1')
    expect(turn).toMatchObject({
      stepCount: 3,
      startedAt: 't0',
      endedAt: 't3',
      running: false,
    })
  })

  it('keeps interim agent messages in the work', () => {
    const [turn] = agentTurnsOf([user('u1'), agent('a1'), tools('tl1', 1), agent('a2')])
    expect(turn?.work.map((item) => item.id)).toEqual(['a1', 'tl1'])
    expect(turn?.answer?.id).toBe('a2')
    expect(turn?.stepCount).toBe(1)
  })

  it('has no answer when the run ends on work', () => {
    const [turn] = agentTurnsOf([user('u1'), tools('tl1', 1)])
    expect(turn?.answer).toBeNull()
    expect(turn?.work).toHaveLength(1)
  })

  it('starts a turn at its preceding user message and falls back to its first item', () => {
    const turns = agentTurns(
      turnsOf({
        items: [agent('a0', 'x1'), user('u1', 'x2'), agent('a1', 'x3')],
        working: false,
      }),
    )
    expect(turns.map((turn) => turn.startedAt)).toEqual(['x1', 'x2'])
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
    expect(agentTurns(turns)[0]).toMatchObject({
      work: [],
      answer: null,
      stepCount: 0,
      running: true,
      startedAt: 't0',
    })
  })

  it('adds nothing for a user-only tail when idle', () => {
    expect(turnsOf({ items: [user('u1')], working: false })).toHaveLength(1)
  })

  it('keeps a streaming trailing answer under a running summary', () => {
    const [turn] = agentTurnsOf([user('u1'), thought('th1'), agent('a1', undefined, true)], true)
    expect(turn).toMatchObject({ running: true, stepCount: 1 })
    expect(turn?.answer?.id).toBe('a1')
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
