import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import * as realSonner from 'sonner'

import { withdrawStore } from '@dltech/atlas-client/session'
import { EOutgoingPlacement } from '@dltech/atlas-client/stream'
import {
  chainEvents,
  EInputConsumed,
  toRunId,
  toThreadId,
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
const { useStagedMessages } = await import('../use-staged-messages')
const { stageMessage, settleMessages } = await import('../staged-store')

const SESSION = 'ses-staged-withdraw'

const CLIENT_ID = 'client-a'

const INBOX = 4

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
  inboxId: INBOX,
  kind: 'message',
  postedAt: '2026-11-25T10:00:00.000Z',
  message: { text: 'ship it', clientId: CLIENT_ID },
}

const CONSUMED: RecordEventBody = {
  type: 'input-consumed',
  inboxId: INBOX,
  consumed: EInputConsumed.Message,
}

const REFUSED: RecordEventBody = {
  type: 'input-refused',
  inboxId: 9,
  targetInboxId: INBOX,
  reason: 'already-sent',
}

const pending: PendingInputsState = {
  pending: [
    {
      inboxId: INBOX,
      seq: INBOX,
      at: '2026-11-25T10:00:00.000Z',
      kind: 'message',
      message: { text: 'ship it', clientId: CLIENT_ID },
    },
  ],
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
  settleMessages({ sessionId: SESSION, clientIds: new Set([CLIENT_ID]) })
  withdrawStore.clear(SESSION)
  shown.length = 0
})

type Harness = {
  drafts: string[]
  edit: () => void
  show: (args: { foldable: readonly RecordEvent[]; pending?: PendingInputsState }) => Promise<void>
}

const mount = async (): Promise<Harness> => {
  const { createRoot } = await import('react-dom/client')
  const element = document.createElement('div')
  const instance = createRoot(element)
  const drafts: string[] = []
  const draft = 'a draft'
  const props = {
    sessionId: SESSION,
    pending,
    events: eventsOf([POSTED, CONSUMED, REFUSED]),
    foldable: eventsOf([POSTED]),
    items: [],
    draft,
  }
  let latest: ReturnType<typeof useQueuedTranscript> | undefined

  function Probe() {
    const staged = useStagedMessages({
      sessionId: SESSION,
      events: props.events,
      pending: props.pending,
      draft,
      onDraftChange: (next) => drafts.push(next),
      onRestoreAttachments: () => undefined,
    })
    latest = useQueuedTranscript({
      ...props,
      staged: staged.staged,
      onDraftChange: (next) => drafts.push(next),
      onRestoreAttachments: () => undefined,
      api: { withdraw: async () => ({ ok: true as const }) },
    })
    return null
  }

  const render = async () => {
    await act(async () => instance.render(<Probe />))
  }

  await render()
  root = instance
  host = element
  await act(async () => {
    stageMessage({
      sessionId: SESSION,
      message: {
        clientId: CLIENT_ID,
        text: 'ship it',
        attachments: [],
        placement: EOutgoingPlacement.Transcript,
        at: '2026-11-25T10:00:00.000Z',
      },
    })
  })

  const probeOf = () => {
    if (latest === undefined) throw new Error('the probe never rendered')
    return latest
  }

  return {
    drafts,
    edit: () => probeOf().queued.onEdit(String(INBOX)),
    show: async (next) => {
      props.foldable = next.foldable
      props.pending = next.pending ?? props.pending
      await render()
    },
  }
}

describe('a withdrawn staged send on web', () => {
  it('toasts once when the agent consumed the message and the withdraw is refused', async () => {
    const harness = await mount()

    await act(async () => harness.edit())
    await act(async () => undefined)
    const page = eventsOf([POSTED, CONSUMED, REFUSED])
    await act(async () => harness.show({ foldable: page, pending: { pending: [] } }))
    await act(async () => harness.show({ foldable: page, pending: { pending: [] } }))

    expect(shown).toEqual(['Already sent — the agent got it'])
    expect(harness.drafts).toEqual(['ship it\n\na draft'])
  })
})
