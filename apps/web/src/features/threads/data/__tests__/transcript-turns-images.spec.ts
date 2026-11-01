import { describe, expect, it } from 'bun:test'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { ETranscriptKind, type TranscriptItem } from '../transcript-items'
import { ESegmentKind, ETurnKind, turnsOf, type AgentTurn, type Segment } from '../transcript-turns'

const user = (id: string, at: string): TranscriptItem => ({
  kind: ETranscriptKind.User,
  id,
  text: id,
  at,
})
const agent = (id: string, at: string): TranscriptItem => ({
  kind: ETranscriptKind.Agent,
  id,
  text: id,
  streaming: false,
  at,
})
const tools = (id: string, count: number, at: string): TranscriptItem => ({
  kind: ETranscriptKind.Tools,
  id,
  calls: Array.from({ length: count }, (_, index) => ({
    id: `${id}-${index}`,
    kind: EToolKind.Shell,
    state: EToolState.Done,
    label: 'ls',
  })),
  at,
})
const read = (id: string, at: string): TranscriptItem => ({
  kind: ETranscriptKind.Tools,
  id,
  calls: [
    {
      id: `${id}-0`,
      kind: EToolKind.Read,
      state: EToolState.Done,
      label: 'shot.png',
      image: { id: `${id}-0#image`, src: 'data:image/png;base64,iVBOR', alt: 'shot.png' },
    },
  ],
  at,
})

const agentTurns = (turns: ReturnType<typeof turnsOf>): AgentTurn[] =>
  turns.flatMap((turn) => (turn.kind === ETurnKind.Agent ? [turn] : []))

const agentTurnsOf = (items: TranscriptItem[]): AgentTurn[] =>
  agentTurns(turnsOf({ items, working: false }))

const shapeOf = (segments: readonly Segment[] | undefined): string[] =>
  (segments ?? []).map((segment) => {
    if (segment.kind === ESegmentKind.Message) return `message:${segment.item.id}`
    if (segment.kind === ESegmentKind.Images)
      return `images:${segment.images.map((image) => image.id).join(',')}`
    return `work:${segment.items.map((item) => item.id).join(',')}`
  })

describe('read images break out of work groups', () => {
  it('closes the work group at a read image and starts a new one after it', () => {
    const [turn] = agentTurnsOf([
      user('u1', 't0'),
      tools('tl1', 2, 't1'),
      read('r1', 't2'),
      tools('tl2', 1, 't3'),
      agent('a1', 't4'),
    ])
    expect(shapeOf(turn?.segments)).toEqual([
      'work:tl1,r1',
      'images:r1-0#image',
      'work:tl2',
      'message:a1',
    ])
    const work = turn?.segments.filter((segment) => segment.kind === ESegmentKind.Work)
    expect(work).toMatchObject([
      { startedAt: 't0', endedAt: 't2', stepCount: 3 },
      { startedAt: 't2', endedAt: 't4', stepCount: 1 },
    ])
  })

  it('opens a fresh running work group after a trailing image while working', () => {
    const turns = turnsOf({
      items: [user('u1', 't0'), read('r1', 't1')],
      working: true,
    })
    const [turn] = agentTurns(turns)
    expect(shapeOf(turn?.segments)).toEqual(['work:r1', 'images:r1-0#image', 'work:'])
    expect(turn?.segments.at(-1)).toMatchObject({
      running: true,
      startedAt: 't1',
    })
    expect(turn?.segments[0]).toMatchObject({ running: false })
  })
})
