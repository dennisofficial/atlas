import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EResumePoint, type ResumePoint } from '@dltech/atlas-core'

import { ETranscriptKind } from '../../data/transcript-kind'
import { ESegmentKind, ETurnKind, type AgentTurn, type Segment } from '../../data/transcript-turns'
import { RESUMING_LABEL, RESUME_LABEL, STOPPED_LABEL } from '../stopped-line'
import { TurnView, type TranscriptActions } from '../transcript-turn'

const ACTIONS: TranscriptActions = {
  rewind: null,
  summarise: null,
  resume: null,
  openChanges: null,
  openAgent: null,
}

const CLEAN: ResumePoint = { kind: EResumePoint.Clean, discard: null }
const NOT_RESUMABLE: ResumePoint = { kind: EResumePoint.NotResumable, because: 'done' }

const turnOf = (segments: Segment[]): AgentTurn => ({
  kind: ETurnKind.Agent,
  id: 'turn:1',
  segments,
  spawns: [],
  running: false,
})

const render = (segments: Segment[], actions: TranscriptActions = ACTIONS) =>
  renderToStaticMarkup(
    <TurnView
      turn={turnOf(segments)}
      now={0}
      models={new Map()}
      userName={undefined}
      actions={actions}
    />,
  )

const thinking = (stopped: boolean, resume?: ResumePoint | null): Segment => ({
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
      ...(resume === undefined ? {} : { resume }),
    },
  ],
  stepCount: 1,
  running: false,
})

const said = (stopped: boolean, resume?: ResumePoint | null): Segment => ({
  kind: ESegmentKind.Message,
  id: 'e1#1',
  item: {
    kind: ETranscriptKind.Agent,
    id: 'e1#1',
    text: 'It was the',
    streaming: false,
    ...(stopped ? { stopped: true as const } : {}),
    ...(resume === undefined ? {} : { resume }),
  },
  final: true,
})

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  )

const resumeActions = (onResume: () => void, pending = false): TranscriptActions => ({
  ...ACTIONS,
  resume: { pending, onResume },
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

describe('resuming a stopped turn from the transcript', () => {
  it('offers Resume on a resumable stopped reply', () => {
    const html = render(
      [said(true, CLEAN)],
      resumeActions(() => undefined),
    )

    expect(html).toContain('data-slot="resume-turn"')
    expect(html).toContain(RESUME_LABEL)
  })

  it('offers Resume on a stopped thinking-only turn', () => {
    const html = render(
      [thinking(true, CLEAN)],
      resumeActions(() => undefined),
    )

    expect(html).toContain('data-slot="resume-turn"')
  })

  it('takes the point from the last stopped thought of the work segment', () => {
    const html = render(
      [
        {
          kind: ESegmentKind.Work,
          id: 'turn:1:work:start',
          items: [
            {
              kind: ETranscriptKind.Thought,
              id: 'e1#0',
              text: 'first thought',
              streaming: false,
              heldOpen: false,
              stopped: true,
            },
            {
              kind: ETranscriptKind.Thought,
              id: 'e1#1',
              text: 'second thought',
              streaming: false,
              heldOpen: false,
              stopped: true,
              resume: CLEAN,
            },
          ],
          stepCount: 2,
          running: false,
        },
      ],
      resumeActions(() => undefined),
    )

    expect(html).toContain('data-slot="stopped-line"')
    expect(html).toContain('data-slot="resume-turn"')
  })

  it('hides the action when the core says the turn is not resumable', () => {
    const html = render(
      [said(true, NOT_RESUMABLE)],
      resumeActions(() => undefined),
    )

    expect(html).toContain('data-slot="stopped-line"')
    expect(html).not.toContain('data-slot="resume-turn"')
  })

  it('shows Resuming… and disables itself while the entry is pending', () => {
    const html = render(
      [said(true, CLEAN)],
      resumeActions(() => undefined, true),
    )

    expect(html).toContain(RESUMING_LABEL)
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Resuming…<\/button>/)
  })
})

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the Resume action', () => {
  it('posts once when the operator presses it', async () => {
    const calls: string[] = []
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () =>
      createRoot(container).render(
        <TurnView
          turn={turnOf([said(true, CLEAN)])}
          now={0}
          models={new Map()}
          userName={undefined}
          actions={resumeActions(() => calls.push('resume'))}
        />,
      ),
    )

    const button = buttonNamed(RESUME_LABEL)
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(calls).toEqual(['resume'])
  })
})
