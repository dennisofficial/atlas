import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../data/events-from-wire'
import {
  durableTranscriptOf,
  ETranscriptKind,
  transcriptViewOf,
  type TranscriptRow,
} from '../data/transcript-items'
import { mount, mountWith, rewindButton } from './transcript-mount'
import { installVirtuaViewport } from './virtua-viewport'

let restoreViewport = () => {}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoreViewport = installVirtuaViewport()
})

afterAll(async () => {
  restoreViewport()
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ThreadTranscript failure card', () => {
  it('renders the card instead of the plain marker when a card is given', async () => {
    await mountWith({
      rewind: null,
      failureCard: {
        title: 'Anthropic rejected the API key',
        detail: 'bad key',
      },
      failedLabel: 'run failed after 2s',
    })

    const text = document.body.textContent ?? ''
    expect(text).toContain('Anthropic rejected the API key')
    expect(text).toContain('bad key')
    expect(text).not.toContain('run failed after 2s')
  })
})

describe('ThreadTranscript rewind', () => {
  it('renders the rewind action on a user turn and reports the event id', async () => {
    const picked: { eventId: string; text: string }[] = []
    await mount({
      points: new Set(['evt_2']),
      onRewind: (pick) => picked.push(pick),
    })

    await act(async () => {
      rewindButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(picked).toEqual([{ eventId: 'evt_2', text: 'try again' }])
  })

  it('renders no rewind action on a user turn that is not a rewind point', async () => {
    await mount({ points: new Set(), onRewind: () => undefined })

    expect(rewindButton()).toBeNull()
  })

  it('renders no rewind action without the rewind prop', async () => {
    await mount(null)

    expect(rewindButton()).toBeNull()
  })
})

describe('ThreadTranscript work groups', () => {
  it('shows an interim agent message outside the collapsed work groups', async () => {
    const at = (second: number) => `2026-10-28T10:00:0${second}.000Z`
    const call = (id: string) => ({
      id,
      kind: EToolKind.Shell,
      state: EToolState.Done,
      label: `ran ${id}`,
    })
    await mount(null, [
      { kind: ETranscriptKind.User, id: 'u1', text: 'raise it', at: at(0) },
      {
        kind: ETranscriptKind.Tools,
        id: 'tl1',
        calls: [call('c1')],
        at: at(1),
      },
      {
        kind: ETranscriptKind.Agent,
        id: 'a1',
        text: 'Interim progress note',
        streaming: false,
        at: at(2),
      },
      {
        kind: ETranscriptKind.Tools,
        id: 'tl2',
        calls: [call('c2')],
        at: at(3),
      },
      {
        kind: ETranscriptKind.Agent,
        id: 'a2',
        text: 'Final answer',
        streaming: false,
        at: at(4),
      },
    ])

    const text = document.body.textContent ?? ''
    expect(text).toContain('Interim progress note')
    expect(text).toContain('Final answer')
    expect(text).not.toContain('ran c1')
    expect(text.match(/Worked for/g)).toHaveLength(2)
  })
})

describe('ThreadTranscript read images', () => {
  it('breaks the work group at a picture a read returned', async () => {
    const at = (second: number) => `2026-10-28T10:00:0${second}.000Z`
    await mount(null, [
      { kind: ETranscriptKind.User, id: 'u1', text: 'look at it', at: at(0) },
      {
        kind: ETranscriptKind.Tools,
        id: 'tl1',
        calls: [
          {
            id: 'c1',
            kind: EToolKind.Read,
            state: EToolState.Done,
            label: 'shot.png',
            image: {
              id: 'c1#image',
              src: 'data:image/png;base64,iVBOR',
              alt: 'shot.png',
            },
          },
        ],
        at: at(1),
      },
      {
        kind: ETranscriptKind.Tools,
        id: 'tl2',
        calls: [
          {
            id: 'c2',
            kind: EToolKind.Shell,
            state: EToolState.Done,
            label: 'ran c2',
          },
        ],
        at: at(2),
      },
      {
        kind: ETranscriptKind.Agent,
        id: 'a1',
        text: 'Seen it',
        streaming: false,
        at: at(3),
      },
    ])

    const picture = document.body.querySelector('img')
    expect(picture?.getAttribute('src')).toBe('data:image/png;base64,iVBOR')
    expect(document.body.textContent).not.toContain('Read shot.png')
    const text = document.body.textContent ?? ''
    expect(text.match(/Worked for/g)).toHaveLength(2)
    const groups = [...document.body.querySelectorAll('*')].filter(
      (node) => node.children.length === 0 && node.textContent?.startsWith('Worked for'),
    )
    const [first, second] = groups
    const follows = (a: Node | undefined, b: Node | undefined) =>
      a !== undefined &&
      b !== undefined &&
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows(first, picture ?? undefined)).toBe(true)
    expect(follows(picture ?? undefined, second)).toBe(true)
  })
})

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-28T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const rowsOfWire = (events: WireEvent[]): TranscriptRow[] =>
  transcriptViewOf({
    durable: durableTranscriptOf({ events: eventsFromWire(events) }),
    live: [],
  }).items

describe('ThreadTranscript harness notices', () => {
  it('renders the pr-event and nudge entries that woke the agent', async () => {
    await mount(
      null,
      rowsOfWire([
        wire(1, { type: 'user-said', text: 'merge it' }),
        wire(2, {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'Waiting on CI' }],
        }),
        wire(3, {
          type: 'pr-event',
          repo: 'dltech/atlas',
          prNumber: 12,
          kind: 'state',
          url: 'https://github.com/dltech/atlas/pull/12',
          state: 'merged',
        }),
        wire(4, {
          type: 'assistant-said',
          parts: [{ type: 'text', text: 'It merged' }],
        }),
        wire(5, { type: 'nudge', text: 'check the build', lifetimeSteps: 3 }),
      ]),
    )

    const text = document.body.textContent ?? ''
    expect(text).toContain('PR #12: merged')
    expect(text).toContain('Atlas noticed — nudge')
    expect(text).toContain('It merged')
  })
})
