import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import * as realSonner from 'sonner'

import {
  EAttachmentStore,
  ERewindCause,
  ETurnCause,
  pendingInputsOf,
  type Attachment,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { quickStopsOf } from '@dltech/atlas-client/session'
import { EOutgoingPlacement } from '@dltech/atlas-client/stream'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

const realSonnerExports = { ...realSonner }
const shownNotices: string[] = []
const shownErrors: string[] = []

mock.module('sonner', () => ({
  toast: Object.assign((notice: string) => shownNotices.push(notice), {
    error: (error: string) => shownErrors.push(error),
  }),
}))

const { useQuickStopRestore } = await import('../use-quick-stop-restore')
const { useStagedMessages } = await import('../use-staged-messages')

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('sonner', () => realSonnerExports)
  await unregisterDom()
})

afterEach(() => {
  shownNotices.length = 0
  shownErrors.length = 0
})

const AT = '2026-11-23T10:00:00.000Z'

const stagedOf = (clientId: string, text: string, attachments: readonly Attachment[] = []) => ({
  clientId,
  text,
  attachments,
  placement: EOutgoingPlacement.Transcript,
  at: AT,
})

type Handles = {
  stage?: ReturnType<typeof useStagedMessages>['stage']
  staged?: readonly string[]
  draft: string
  restoredAttachments: readonly Attachment[]
  quickStops: { text: string; attachments: readonly Attachment[] }[]
}

const mount = async (args: { sessionId: string; events?: readonly V2Event[] }) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const handles: Handles = { draft: '', restoredAttachments: [], quickStops: [] }
  function Probe({ events }: { events: readonly V2Event[] }) {
    const staged = useStagedMessages({
      sessionId: args.sessionId,
      events,
      pending: pendingInputsOf(events),
      draft: '',
      onDraftChange: (draft) => {
        handles.draft = draft
      },
      onRestoreAttachments: (attachments) => {
        handles.restoredAttachments = attachments
      },
    })
    useQuickStopRestore({
      sessionId: args.sessionId,
      quickStops: quickStopsOf(events),
      onRestore: (restored) => {
        handles.quickStops = [...handles.quickStops, restored]
      },
    })
    handles.stage = staged.stage
    handles.staged = staged.staged.map((entry) => entry.clientId)
    return <p>{handles.staged.join(',')}</p>
  }
  const render = async (events: readonly V2Event[]): Promise<void> => {
    await act(async () => root.render(<Probe events={events} />))
  }
  await render(args.events ?? [])
  return { host, root, handles, render }
}

const SHOT: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

const POSTED_ROW = (clientId: string, inboxId: number): V2Body => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: AT,
  message: { text: 'hello', clientId },
})

const QUICK_STOP = (clientId: string): V2Body[] => [
  { type: 'user-said', text: 'hello', clientId, inboxId: 3 },
  { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input },
  { type: 'assistant-said', parts: [{ type: 'reasoning', text: 'hm' }] },
  { type: 'turn-ended', turnId: 'turn-1', outcome: 'stopped', by: 'operator' },
  { type: 'history-rewound', toSeq: 0, draft: 'hello', cause: ERewindCause.QuickStop },
]

describe('useStagedMessages', () => {
  it('keeps a staged message after the view unmounts and mounts again', async () => {
    const first = await mount({ sessionId: 'kept-1' })
    await act(async () => first.handles.stage?.(stagedOf('c1', 'hello')))
    expect(first.host.textContent).toBe('c1')
    await act(async () => first.root.unmount())

    const second = await mount({ sessionId: 'kept-1' })
    expect(second.host.textContent).toBe('c1')
    await act(async () => second.root.unmount())
  })

  it('keeps each session to its own staged messages', async () => {
    const first = await mount({ sessionId: 'isolated-1' })
    await act(async () => first.handles.stage?.(stagedOf('a1', 'one')))
    const second = await mount({ sessionId: 'isolated-2' })
    expect(second.host.textContent).toBe('')
    await act(async () => second.handles.stage?.(stagedOf('b1', 'two')))
    expect(first.host.textContent).toBe('a1')
    expect(second.host.textContent).toBe('b1')
    await act(async () => first.root.unmount())
    await act(async () => second.root.unmount())
  })

  it('keeps a staged message while its input is posted but not read yet', async () => {
    const view = await mount({ sessionId: 'unread-1' })
    await act(async () => view.handles.stage?.(stagedOf('u1', 'hello')))
    await view.render(
      mintEvents({
        bodies: [
          {
            type: 'input-posted',
            inboxId: 2,
            kind: 'message',
            postedAt: AT,
            message: { text: 'hello', clientId: 'u1' },
          },
        ],
      }),
    )
    expect(view.host.textContent).toBe('u1')

    await view.render(
      mintEvents({
        bodies: [
          {
            type: 'input-posted',
            inboxId: 2,
            kind: 'message',
            postedAt: AT,
            message: { text: 'hello', clientId: 'u1' },
          },
          { type: 'user-said', text: 'hello', clientId: 'u1', inboxId: 2 },
        ],
      }),
    )
    expect(view.host.textContent).toBe('')
    await act(async () => view.root.unmount())
  })

  it('drops a staged message once an event confirms it', async () => {
    const view = await mount({ sessionId: 'settled-1' })
    await act(async () => view.handles.stage?.(stagedOf('s1', 'hello')))
    expect(view.host.textContent).toBe('s1')
    await view.render(
      mintEvents({ bodies: [{ type: 'user-said', text: 'hello', clientId: 's1' }] }),
    )
    expect(view.host.textContent).toBe('')
    await act(async () => view.root.unmount())
  })

  it('puts a message the stop discarded back in the composer with its attachment', async () => {
    const view = await mount({ sessionId: 'discarded-1' })
    await act(async () => view.handles.stage?.(stagedOf('d1', 'hello', [SHOT])))
    await view.render(
      mintEvents({
        bodies: [
          POSTED_ROW('d1', 2),
          { type: 'input-consumed', inboxId: 2, consumed: 'discarded' },
        ],
      }),
    )

    expect(view.handles.draft).toBe('hello')
    expect(view.handles.restoredAttachments).toEqual([SHOT])
    expect(view.host.textContent).toBe('')
    await act(async () => view.root.unmount())
  })

  it('restores a quick stop once for the client that sent the message', async () => {
    const view = await mount({ sessionId: 'quick-stop-1' })
    await act(async () => view.handles.stage?.(stagedOf('q1', 'hello')))
    const rewound = mintEvents({ bodies: QUICK_STOP('q1') })
    await view.render(rewound)

    expect(view.handles.quickStops.map((restored) => restored.text)).toEqual(['hello'])

    await view.render(rewound)
    expect(view.handles.quickStops).toHaveLength(1)
    await act(async () => view.root.unmount())
  })

  it("leaves another client's message out of a quick stop", async () => {
    const view = await mount({ sessionId: 'quick-stop-2' })
    await act(async () => view.handles.stage?.(stagedOf('mine', 'hello')))
    await view.render(mintEvents({ bodies: QUICK_STOP('theirs') }))

    expect(view.handles.quickStops).toEqual([])
    await act(async () => view.root.unmount())
  })

  it('leaves a message another device withdrew out of the composer', async () => {
    const view = await mount({ sessionId: 'withdrawn-1' })
    await act(async () => view.handles.stage?.(stagedOf('w1', 'hello', [SHOT])))
    await view.render(
      mintEvents({
        bodies: [POSTED_ROW('w1', 2), { type: 'input-withdrawn', inboxId: 2, requestInboxId: 5 }],
      }),
    )

    expect(view.handles.draft).toBe('')
    expect(view.handles.restoredAttachments).toEqual([])
    expect(shownNotices).toEqual([])
    expect(shownErrors).toEqual([])
    expect(view.host.textContent).toBe('')
    await act(async () => view.root.unmount())
  })

  it('leaves a refused withdraw to the withdraw, which owns the notice', async () => {
    const view = await mount({ sessionId: 'withdraw-refused-1' })
    await act(async () => view.handles.stage?.(stagedOf('r1', 'hello', [SHOT])))
    await view.render(
      mintEvents({
        bodies: [
          POSTED_ROW('r1', 2),
          { type: 'input-refused', inboxId: 5, targetInboxId: 2, reason: 'already-sent' },
        ],
      }),
    )

    expect(view.handles.draft).toBe('')
    expect(view.handles.restoredAttachments).toEqual([])
    expect(shownNotices).toEqual([])
    expect(shownErrors).toEqual([])
    expect(view.host.textContent).toBe('')
    await act(async () => view.root.unmount())
  })

  it('still puts a message the host refused on its own back in the composer with its attachments', async () => {
    const view = await mount({ sessionId: 'refused-1' })
    await act(async () => view.handles.stage?.(stagedOf('x1', 'hello', [SHOT])))
    await view.render(
      mintEvents({
        bodies: [
          POSTED_ROW('x1', 2),
          { type: 'input-refused', inboxId: 2, reason: 'session is archived' },
        ],
      }),
    )

    expect(view.handles.draft).toBe('hello')
    expect(view.handles.restoredAttachments).toEqual([SHOT])
    expect(shownErrors).toEqual(['session is archived'])
    await act(async () => view.root.unmount())
  })
})
