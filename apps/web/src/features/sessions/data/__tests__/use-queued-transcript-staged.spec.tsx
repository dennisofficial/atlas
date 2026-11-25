import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EOutgoingPlacement } from '@dltech/atlas-client/stream'
import {
  chainEvents,
  toRunId,
  toThreadId,
  type PendingInputsState,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import type { StagedMessage } from '../queued-messages'
import { useQueuedTranscript } from '../use-queued-transcript'

const SESSION = 'ses-staged'

const eventsOf = (bodies: readonly RecordEventBody[]): readonly RecordEvent[] =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-25T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const stagedMessage: StagedMessage = {
  clientId: 'client-a',
  text: 'ship it',
  attachments: [],
  placement: EOutgoingPlacement.Transcript,
  at: '2026-11-25T10:00:00.000Z',
}

const postedStaged = eventsOf([
  {
    type: 'input-posted',
    inboxId: 4,
    kind: 'message',
    postedAt: '2026-11-25T10:00:00.000Z',
    message: { text: 'ship it', clientId: 'client-a' },
  },
])

const pendingStaged: PendingInputsState = {
  pending: [
    {
      inboxId: 4,
      seq: 4,
      at: '2026-11-25T10:00:00.000Z',
      kind: 'message',
      message: { text: 'ship it', clientId: 'client-a' },
    },
  ],
}

type Harness = {
  rows: () => number
  transcript: () => number
  done: () => Promise<void>
}

const mount = async (args: {
  pending: PendingInputsState
  staged: readonly StagedMessage[]
  events: readonly RecordEvent[]
}): Promise<Harness> => {
  const { createRoot } = await import('react-dom/client')
  const element = document.createElement('div')
  const root: Root = createRoot(element)
  let latest: ReturnType<typeof useQueuedTranscript> | undefined

  function Probe() {
    latest = useQueuedTranscript({
      sessionId: SESSION,
      pending: args.pending,
      events: args.events,
      foldable: args.events,
      staged: args.staged,
      items: [],
      draft: '',
      onDraftChange: () => undefined,
      onRestoreAttachments: () => undefined,
    })
    return null
  }

  await act(async () => root.render(<Probe />))

  const probeOf = () => {
    if (latest === undefined) throw new Error('the probe never rendered')
    return latest
  }

  return {
    rows: () => probeOf().queued.rows.length,
    transcript: () => probeOf().transcript.length,
    done: async () => {
      await act(async () => root.unmount())
      element.remove()
    },
  }
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

describe('placing a staged send on web', () => {
  it('shows one transcript item and no queue row for an idle send the record already posted', async () => {
    const harness = await mount({
      pending: pendingStaged,
      staged: [stagedMessage],
      events: postedStaged,
    })

    try {
      expect(harness.transcript()).toBe(1)
      expect(harness.rows()).toBe(0)
    } finally {
      await harness.done()
    }
  })
})
