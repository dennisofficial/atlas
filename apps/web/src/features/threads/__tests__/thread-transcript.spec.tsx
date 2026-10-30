import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../data/events-from-wire'
import { durableTranscriptOf, transcriptViewOf } from '../data/transcript-items'

import { ETranscriptKind, type TranscriptRow } from '../data/transcript-items'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { EMPTY_DETAILS } from '../panel/details/details-input'
import { ThreadTranscript, type TranscriptRewind } from '../thread-transcript'
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

const panel: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  openContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const items: TranscriptRow[] = [
  {
    kind: ETranscriptKind.User,
    id: 'evt_2',
    text: 'try again',
    at: '2026-10-28T10:00:00.000Z',
  },
]

const mount = async (rewind: TranscriptRewind | null, rows: TranscriptRow[] = items) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <ThreadPanelProvider value={panel}>
          <ThreadTranscript
            items={rows}
            failure={null}
            pod={null}
            working={false}
            onRetryBoot={() => undefined}
            rewind={rewind}
          />
        </ThreadPanelProvider>
      </TestQueryProvider>,
    ),
  )
}

const rewindButton = () => document.body.querySelector('button[aria-label="Rewind to here"]')

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
