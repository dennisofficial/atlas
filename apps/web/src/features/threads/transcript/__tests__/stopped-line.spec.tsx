import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ETranscriptKind } from '../../data/transcript-kind'
import { ESegmentKind, ETurnKind, type AgentTurn, type Segment } from '../../data/transcript-turns'
import { STOPPED_LABEL } from '../stopped-line'
import { TurnView, type TranscriptActions } from '../transcript-turn'

const ACTIONS: TranscriptActions = {
  rewind: null,
  summarise: null,
  openChanges: null,
  openAgent: null,
  repairDiagram: null,
}

const turnOf = (segments: Segment[]): AgentTurn => ({
  kind: ETurnKind.Agent,
  id: 'turn:1',
  segments,
  spawns: [],
  running: false,
})

const render = (segments: Segment[]) =>
  renderToStaticMarkup(
    <TurnView
      turn={turnOf(segments)}
      now={0}
      models={new Map()}
      userName={undefined}
      actions={ACTIONS}
    />,
  )

const thinking = (stopped: boolean): Segment => ({
  kind: ESegmentKind.Work,
  id: 'turn:1:work:start',
  items: [
    {
      kind: ETranscriptKind.Thought,
      id: 'e1#0',
      text: 'weighing it up',
      streaming: false,
      heldOpen: false,
      ...(stopped ? { stopped: true as const } : {}),
    },
  ],
  stepCount: 1,
  running: false,
})

const said = (stopped: boolean): Segment => ({
  kind: ESegmentKind.Message,
  id: 'e1#1',
  item: {
    kind: ETranscriptKind.Agent,
    id: 'e1#1',
    text: 'It was the',
    streaming: false,
    ...(stopped ? { stopped: true as const } : {}),
  },
  final: true,
})

describe('a reply the operator stopped', () => {
  it('ends the prose with a Stopped line', () => {
    const html = render([said(true)])

    expect(html).toContain('It was the')
    expect(html).toContain('data-slot="stopped-line"')
    expect(html).toContain(STOPPED_LABEL)
  })

  it('follows thinking-only work with a Stopped line', () => {
    const html = render([thinking(true)])

    expect(html).toContain('data-slot="stopped-line"')
  })

  it('shows no Stopped line on a reply nobody stopped', () => {
    expect(render([thinking(false), said(false)])).not.toContain('data-slot="stopped-line"')
  })
})
