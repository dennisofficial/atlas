import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import * as realSonner from 'sonner'

import { withdrawStore } from '@dltech/atlas-client/session'
import {
  chainEvents,
  toRunId,
  toThreadId,
  type Attachment,
  type PendingInputsState,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

const realSonnerExports = { ...realSonner }

const shown: string[] = []

mock.module('sonner', () => ({
  toast: Object.assign((title: string) => shown.push(title), {
    error: (title: string) => shown.push(title),
  }),
}))

const { useQueuedTranscript } = await import('../use-queued-transcript')

const SESSION = 'ses-withdraw'

const attachments: readonly Attachment[] = [
  {
    id: 'att-1',
    name: 'diagram.png',
    mediaType: 'image/png',
    size: 12,
    content: { store: 'inline', data: 'aGVsbG8=' },
  },
]

const pendingOf = (message: {
  text: string
  attachments?: readonly Attachment[]
}): PendingInputsState => ({
  pending: [
    {
      inboxId: 4,
      seq: 4,
      at: '2026-11-25T10:00:00.000Z',
      kind: 'message',
      message: {
        text: message.text,
        ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
      },
    },
  ],
})

const eventsOf = (bodies: readonly RecordEventBody[]): readonly RecordEvent[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-25T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const POSTED: RecordEventBody = {
  type: 'input-posted',
  inboxId: 4,
  kind: 'message',
  postedAt: '2026-11-25T10:00:00.000Z',
  message: { text: 'ship it' },
}

const REFUSED: RecordEventBody = {
  type: 'input-refused',
  inboxId: 9,
  targetInboxId: 4,
  reason: 'already-sent',
}

let root: Root | null = null
let host: HTMLDivElement | null = null

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
  host?.remove()
  host = null
  withdrawStore.clear(SESSION)
  shown.length = 0
  window.localStorage.clear()
})

type Harness = {
  drafts: string[]
  restored: (readonly Attachment[])[]
  rows: () => number
  wants: () => number
  edit: () => void
  remove: () => void
  show: (args: { foldable: readonly RecordEvent[] }) => Promise<void>
}

const mount = async (args: {
  pending: PendingInputsState
  draft?: string
  onWithdraw?: () => Promise<{ ok: true } | { ok: false; reason: 'already-consumed' | 'unknown' }>
}): Promise<Harness> => {
  const { createRoot } = await import('react-dom/client')
  const element = document.createElement('div')
  const instance = createRoot(element)
  const props = {
    sessionId: SESSION,
    pending: args.pending,
    events: eventsOf([POSTED]),
    foldable: eventsOf([POSTED]),
    staged: [],
    items: [],
    draft: args.draft ?? 'a draft',
    api: { withdraw: args.onWithdraw ?? (async () => ({ ok: true as const })) },
  }
  let latest: ReturnType<typeof useQueuedTranscript> | undefined
  const drafts: string[] = []
  const restored: (readonly Attachment[])[] = []
  const calls = { wants: 0 }

  function Probe() {
    latest = useQueuedTranscript({
      ...props,
      onDraftChange: (next) => drafts.push(next),
      onRestoreAttachments: (entry) => restored.push(entry.attachments),
    })
    return null
  }

  const render = async () => {
    await act(async () => instance.render(<Probe />))
  }

  await render()
  root = instance
  host = element

  const probeOf = () => {
    if (latest === undefined) throw new Error('the probe never rendered')
    return latest
  }

  return {
    drafts,
    restored,
    rows: () => probeOf().queued.rows.length,
    wants: () => calls.wants,
    edit: () => probeOf().queued.onEdit('4'),
    remove: () => probeOf().queued.onRemove('4'),
    show: async (next) => {
      props.foldable = next.foldable
      await render()
    },
  }
}

describe('withdrawing a queued message on web', () => {
  it('puts the text and attachments back once for two Edit clicks', async () => {
    const harness = await mount({ pending: pendingOf({ text: 'ship it', attachments }) })

    await act(async () => {
      harness.edit()
      harness.edit()
    })
    await act(async () => undefined)

    expect(harness.drafts).toEqual(['ship it\n\na draft'])
    expect(harness.restored).toEqual([attachments])
    expect(harness.rows()).toBe(0)
  })

  it('hides the row as soon as Remove is clicked and leaves the draft alone', async () => {
    const harness = await mount({ pending: pendingOf({ text: 'ship it' }) })

    await act(async () => harness.remove())
    await act(async () => undefined)

    expect(harness.rows()).toBe(0)
    expect(harness.drafts).toEqual([])
  })

  it('toasts once when the holder refuses, and leaves the text in the composer', async () => {
    const harness = await mount({ pending: pendingOf({ text: 'ship it', attachments }) })

    await act(async () => harness.edit())
    await act(async () => undefined)
    const refused = eventsOf([POSTED, REFUSED])

    await act(async () => harness.show({ foldable: refused }))
    await act(async () => harness.show({ foldable: [...refused] }))

    expect(shown).toEqual(['Already sent — the agent got it'])
    expect(harness.drafts).toEqual(['ship it\n\na draft'])
    expect(harness.restored).toEqual([attachments])
  })

  it('toasts at once when the API refuses before the holder saw it', async () => {
    const harness = await mount({
      pending: pendingOf({ text: 'ship it' }),
      onWithdraw: async () => ({ ok: false, reason: 'already-consumed' }),
    })

    await act(async () => harness.edit())
    await act(async () => undefined)

    expect(shown).toEqual(['Already sent — the agent got it'])
    expect(harness.rows()).toBe(1)
  })

  it('keeps a pending intent hidden after a remount and settles it from the durable lane', async () => {
    withdrawStore.request({ sessionId: SESSION, targetInboxId: 4 })
    const harness = await mount({ pending: pendingOf({ text: 'ship it' }) })
    expect(harness.rows()).toBe(0)

    await act(async () => harness.show({ foldable: eventsOf([POSTED, REFUSED]) }))
    await act(async () => harness.show({ foldable: eventsOf([POSTED, REFUSED]) }))

    expect(shown).toEqual(['Already sent — the agent got it'])
    expect(withdrawStore.intentsOf(SESSION)).toEqual([])
  })
})
