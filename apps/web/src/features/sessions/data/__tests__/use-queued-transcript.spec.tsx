import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'
import type { Root } from 'react-dom/client'
import * as realSonner from 'sonner'

import {
  chainEvents,
  EAttachmentStore,
  pendingInputsOf,
  toRunId,
  toThreadId,
  type Attachment,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'
import { EWithdrawRefusal, type SessionWithdrawOutput } from '@dltech/atlas-protocol'

import type { WithdrawApi } from '../withdraw-queued'

const realSonnerExports = { ...realSonner }
const notices: string[] = []
const errors: string[] = []

mock.module('sonner', () => ({
  toast: Object.assign((notice: string) => notices.push(notice), {
    error: (error: string) => errors.push(error),
  }),
}))

const { useQueuedTranscript } = await import('../use-queued-transcript')

const AT = '2026-11-24T10:00:00.000Z'

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: AT,
    from: undefined,
    bodies,
  })

const SHOT: Attachment = {
  id: 'shot-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: EAttachmentStore.Inline, data: 'AAAA' },
}

const posted: V2Body = {
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: AT,
  message: { text: 'queued text', attachments: [SHOT], clientId: 'c4' },
}

const confirmed = eventsOf([posted, { type: 'input-withdrawn', inboxId: 4, requestInboxId: 5 }])

const refused = eventsOf([
  posted,
  { type: 'input-refused', inboxId: 5, targetInboxId: 4, reason: 'already-sent' },
])

let reply: SessionWithdrawOutput = { ok: true }
const calls: { sessionId: string; inboxId: number }[] = []

const api: WithdrawApi = {
  withdraw: async (input) => {
    calls.push(input)
    return reply
  },
}

type Handles = {
  edit?: ((inboxId: string) => void) | undefined
  remove?: ((inboxId: string) => void) | undefined
  restored: (readonly Attachment[])[]
}

function Probe(args: { events: readonly V2Event[]; handles: Handles }) {
  const [draft, setDraft] = useState('')
  const result = useQueuedTranscript({
    api,
    sessionId: 's-1',
    pending: pendingInputsOf(args.events),
    events: args.events,
    staged: [],
    items: [],
    draft,
    onDraftChange: setDraft,
    onRestoreAttachments: (restored) => {
      args.handles.restored = [...args.handles.restored, restored.attachments]
    },
  })
  args.handles.edit = result.queued.onEdit
  args.handles.remove = result.queued.onRemove
  return <p>{draft}</p>
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('sonner', () => realSonnerExports)
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  notices.length = 0
  errors.length = 0
  calls.length = 0
  reply = { ok: true }
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const mount = async (events: readonly V2Event[]) => {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const handles: Handles = { restored: [] }
  const render = async (next: readonly V2Event[]): Promise<void> => {
    await act(async () => root?.render(<Probe events={next} handles={handles} />))
  }
  await render(events)
  return { handles, render, draft: () => container?.textContent ?? '' }
}

describe('useQueuedTranscript withdraw', () => {
  it('records the request and restores nothing before the holder confirms it', async () => {
    const view = await mount(eventsOf([posted]))

    await act(async () => view.handles.edit?.('4'))
    await settle()

    expect(calls).toEqual([{ sessionId: 's-1', inboxId: 4 }])
    expect(view.draft()).toBe('')
    expect(view.handles.restored).toEqual([])
  })

  it('puts an edited message back once, with its attachment, after the withdraw lands', async () => {
    const view = await mount(eventsOf([posted]))

    await act(async () => view.handles.edit?.('4'))
    await settle()
    await view.render(confirmed)

    expect(view.draft()).toBe('queued text')
    expect(view.handles.restored).toEqual([[SHOT]])
    expect(notices).toEqual([])

    await view.render(confirmed)
    expect(view.handles.restored).toEqual([[SHOT]])
  })

  it('never puts a removed message back', async () => {
    const view = await mount(eventsOf([posted]))

    await act(async () => view.handles.remove?.('4'))
    await settle()
    await view.render(confirmed)

    expect(view.draft()).toBe('')
    expect(view.handles.restored).toEqual([])
  })

  it('says already sent once when the holder refuses the withdraw', async () => {
    const view = await mount(eventsOf([posted]))

    await act(async () => view.handles.edit?.('4'))
    await settle()
    await view.render(refused)

    expect(notices).toEqual(['Already sent'])
    expect(view.draft()).toBe('')
    expect(view.handles.restored).toEqual([])

    await view.render(refused)
    expect(notices).toEqual(['Already sent'])
  })

  it('says already sent when the request itself is refused', async () => {
    reply = { ok: false, reason: EWithdrawRefusal.AlreadyConsumed }
    const view = await mount(eventsOf([posted]))

    await act(async () => view.handles.edit?.('4'))
    await settle()

    expect(notices).toEqual(['Already sent'])
    expect(view.draft()).toBe('')
  })
})
