import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'
import { EBootStep, EBootStepState, type WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '@dltech/atlas-client/transcript'
import { EQueuedRowKind } from '@/features/sessions/data/queued-transcript'
import {
  durableTranscriptOf,
  ENoticeTone,
  ETranscriptKind,
  transcriptViewOf,
  type TranscriptRow,
} from '../data/transcript-items'
import type { BootView } from '../data/boot-view'
import { items, mount, mountLive, mountWith, rewindButton } from './transcript-mount'
import { installVirtuaViewport } from './virtua-viewport'

let restoreViewport = () => {}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoreViewport = installVirtuaViewport()
})

afterAll(async () => {
  restoreViewport()
  await unregisterDom()
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

describe('ThreadTranscript summarise', () => {
  const summariseButton = () =>
    document.body.querySelector('button[aria-label="Summarise up to here"]')

  it('reports the picked message from its summarise button', async () => {
    const picked: string[] = []
    await mountWith({
      rewind: null,
      summarise: {
        points: new Map([['evt_2', { throughSeq: 1, messages: 1 }]]),
        onSummarise: (eventId) => picked.push(eventId),
      },
    })

    await act(async () => (summariseButton() as HTMLElement | null)?.click())

    expect(picked).toEqual(['evt_2'])
  })

  it('renders no summarise action on a message that is not a point', async () => {
    await mountWith({
      rewind: null,
      summarise: { points: new Map(), onSummarise: () => undefined },
    })

    expect(summariseButton()).toBeNull()
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

  it('offers the change-pod-size action on a pod OOM notice', async () => {
    let opens = 0
    await mountWith({
      rewind: null,
      onOpenPodSize: () => {
        opens += 1
      },
      rows: rowsOfWire([
        wire(1, { type: 'user-said', text: 'typecheck the workspace' }),
        wire(2, {
          type: 'pod-ran-out-of-memory',
          incidentId: 'incident-1',
          scope: 'command',
          command: 'bunx turbo run typecheck',
          processes: 3,
          memory: { commandLimitBytes: Math.round(2.3 * 1024 ** 3), podBytes: 4 * 1024 ** 3 },
        }),
      ]),
    })

    expect(document.body.textContent ?? '').toContain(
      "Pod ran out of memory: the kernel killed `turbo run` (commands may use 2.3 GB of the pod's 4 GB)",
    )
    const button = [...document.body.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Change pod size',
    )
    expect(button).toBeDefined()
    await act(async () =>
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
    expect(opens).toBe(1)
  })
})

describe('ThreadTranscript optimistic sends', () => {
  const optimistic: TranscriptRow = {
    kind: ETranscriptKind.User,
    id: 'client-a',
    clientId: 'client-a',
    text: 'ship the dimmer',
    at: '2026-11-23T10:00:00.000Z',
  }

  const landed: TranscriptRow = {
    kind: ETranscriptKind.User,
    id: 'evt_9',
    clientId: 'client-a',
    text: 'ship the dimmer',
    at: '2026-11-23T10:00:00.000Z',
  }

  it('renders an idle send as a landed user turn with no dim and no pending label', async () => {
    await mountWith({ rewind: null, rows: [...items, optimistic] })

    const row = document.body.querySelector('[data-chat-item-id="client-a"]')
    expect(row?.textContent).toContain('ship the dimmer')
    expect(row?.querySelector('[class*="opacity-45"]')).toBeNull()
    expect(row?.textContent).not.toContain('Sending')
    expect(row?.textContent).not.toContain('Queued')
  })

  it('keeps the same chat item when the landed message replaces the optimistic one', async () => {
    const live = await mountLive({ rewind: null, rows: [...items, optimistic] })
    const before = document.body.querySelector('[data-chat-item-id="client-a"]')

    await live.render({ rewind: null, rows: [...items, landed] })

    expect(before).not.toBeNull()
    expect(document.body.querySelector('[data-chat-item-id="evt_9"]')).toBe(before)
  })

  it('disables Edit and Remove on a queued row that has no inbox id yet', async () => {
    await mountWith({
      rewind: null,
      queued: {
        rows: [
          {
            kind: EQueuedRowKind.Message,
            id: 'client-a',
            optimistic: true,
            entry: { id: 'client-a', text: 'ship the dimmer', attachments: [] },
          },
        ],
        onEdit: () => undefined,
        onRemove: () => undefined,
      },
    })

    const row = document.body.querySelector('[data-queued="message"]')
    expect(row?.textContent).toContain('Queued')
    expect(row?.textContent).toContain('ship the dimmer')
    expect(row?.querySelector('button[aria-label="Edit"]')?.hasAttribute('disabled')).toBe(true)
    expect(row?.querySelector('button[aria-label="Remove"]')?.hasAttribute('disabled')).toBe(true)
  })
})

describe('ThreadTranscript queued rows', () => {
  const queued = {
    rows: [
      {
        kind: EQueuedRowKind.Notice as const,
        id: 'queued-5',
        item: {
          kind: ETranscriptKind.Notice as const,
          id: 'queued-5',
          title: 'PR #2617: reviewer commented on thread-transcript.tsx',
          body: 'This dims the whole notice row, including the link.',
          tone: ENoticeTone.Ok,
        },
      },
      {
        kind: EQueuedRowKind.Message as const,
        id: 'queued-3',
        entry: { id: '3', text: 'also dim the timestamp', attachments: [] },
      },
    ],
    onEdit: () => undefined,
    onRemove: () => undefined,
  }

  const chatIds = () =>
    [...document.body.querySelectorAll('[data-slot="chat-item"]')].map((item) =>
      item.getAttribute('data-chat-item-id'),
    )

  const click = async (label: string) => {
    const button = document.body.querySelector(`button[aria-label="${label}"]`)
    await act(async () =>
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
  }

  it('renders the queued rows after the running turn', async () => {
    await mountWith({ rewind: null, working: true, queued })

    const ids = chatIds()
    expect(ids.indexOf('queued-5')).toBeGreaterThan(ids.indexOf('turn:evt_2'))
    expect(ids.indexOf('queued-3')).toBeGreaterThan(ids.indexOf('turn:evt_2'))
  })

  it('renders a queued PR notice with the same title a posted notice gets, dimmed', async () => {
    await mountWith({ rewind: null, queued })

    const row = document.body.querySelector('[data-queued="notice"]')
    expect(row?.className).toContain('opacity-45')
    expect(row?.querySelector('[data-tone="ok"]')).not.toBeNull()
    expect(row?.textContent).toContain('PR #2617: reviewer commented on thread-transcript.tsx')
  })

  it('labels a queued message and reports its inbox id from Edit and Remove', async () => {
    const edits: string[] = []
    const removes: string[] = []
    await mountWith({
      rewind: null,
      queued: {
        ...queued,
        onEdit: (id) => edits.push(id),
        onRemove: (id) => removes.push(id),
      },
    })

    const row = document.body.querySelector('[data-queued="message"]')
    expect(row?.textContent).toContain('Queued')
    expect(row?.textContent).toContain('also dim the timestamp')

    await click('Edit')
    await click('Remove')
    expect(edits).toEqual(['3'])
    expect(removes).toEqual(['3'])
  })
})

describe('ThreadTranscript sandbox boot', () => {
  const DAEMON_ERROR = 'sandbox daemon did not answer atlas-daemon on port 3000\nlog line one'
  const failedBoot: BootView = {
    state: EBootStepState.Error,
    error: DAEMON_ERROR,
    steps: [
      { id: EBootStep.Provision, label: 'Create sandbox', state: EBootStepState.Done },
      {
        id: EBootStep.Serve,
        label: 'Start Atlas',
        state: EBootStepState.Error,
        detail: DAEMON_ERROR,
      },
    ],
  }
  const retryButton = () =>
    [...document.body.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry'),
    ) ?? null

  it('retries a failed sandbox startup', async () => {
    let retried = 0
    await mountWith({
      rewind: null,
      boot: failedBoot,
      onRetryBoot: () => {
        retried += 1
      },
    })

    const button = retryButton()
    expect(button).not.toBeNull()
    await act(async () =>
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    )
    expect(retried).toBe(1)
  })

  it('shows an interrupted setup as restarting, not as a failed start', async () => {
    await mountWith({
      rewind: null,
      onRetryBoot: () => {},
      boot: {
        state: EBootStepState.Running,
        steps: [
          { id: EBootStep.Provision, label: 'Create sandbox', state: EBootStepState.Done },
          {
            id: EBootStep.Setup,
            label: 'Setup restarted · running again',
            state: EBootStepState.Interrupted,
            command: 'bun install',
          },
        ],
      },
    })

    expect(document.body.textContent).toContain('Setup restarted · running again')
    expect(document.body.textContent).not.toContain('Sandbox failed to start')
    expect(document.body.querySelector('[data-slot="sandbox-boot-error"]')).toBeNull()
    expect(retryButton()).toBeNull()
  })

  it('shows the startup error in a labelled card under the failed row', async () => {
    await mountWith({ rewind: null, boot: failedBoot })

    const card = document.body.querySelector('[data-slot="sandbox-boot-error"]')
    expect(card?.textContent).toContain('Sandbox')
    expect(card?.textContent).toContain('sandbox daemon did not answer')
    expect(document.body.textContent).toContain('Sandbox failed to start')
  })
})

describe('a typed command in the transcript', () => {
  it('draws the typed line once, as a command row rather than a bubble', async () => {
    await mountWith({
      rewind: null,
      rows: [
        {
          kind: ETranscriptKind.User,
          id: 'evt_command',
          text: '/rename bench',
          command: { name: 'rename', argumentText: 'bench', text: '/rename bench' },
          at: '2026-10-28T10:00:00.000Z',
        },
      ],
    })

    const rows = document.body.querySelectorAll('[data-slot="message"][data-align="end"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.querySelector('.font-mono')?.textContent).toBe('/rename')
    expect(rows[0]?.textContent).toContain('/rename bench')
    expect(document.body.querySelector('[data-slot="bubble"]')).toBeNull()
  })
})
