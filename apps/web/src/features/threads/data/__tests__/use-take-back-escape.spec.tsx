import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, expect, it, mock } from 'bun:test'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { EPodState, type WireEvent } from '@dltech/atlas-wire/web'

import { cloudThreadBackend } from '../thread-backend'
import { ThreadBackendProvider } from '../use-thread-backend'
import { useTakeBackEscape } from '../use-take-back-escape'
import type { TakenBack } from '../live-thread-view'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

it('local Escape restores only pending text and attachments without removing committed history', async () => {
  const events: WireEvent[] = [
    {
      id: 'evt_1',
      threadId: 'thr_1',
      runId: 'run_1',
      depth: 0,
      seq: 1,
      at: '2026-10-30T00:00:00.000Z',
      type: 'user-said',
      body: JSON.stringify({ text: 'committed', requestId: 'req_1' }),
    },
  ]
  const taken: TakenBack = {
    text: 'pending',
    images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }],
    uploads: [],
  }
  const takeBackPending = mock(async () => taken)
  const restored: TakenBack[] = []
  let data: { visible: WireEvent[]; handleEscape: () => Promise<void>; draft: string } | undefined
  function Probe() {
    const [draft, setDraft] = useState('new typing')
    const escape = useTakeBackEscape({
      threadId: 'thr_1',
      events,
      podState: EPodState.Running,
      setDraft,
      source: { takeBackPending },
      onRestore: (value) => {
        restored.push(value)
      },
    })
    data = { ...escape, draft }
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () =>
      root.render(
        <ThreadBackendProvider backend={{ ...cloudThreadBackend, local: true }}>
          <Probe />
        </ThreadBackendProvider>,
      ),
    )
    await act(async () => {
      await data?.handleEscape()
    })
    expect(takeBackPending).toHaveBeenCalledTimes(1)
    expect(data?.draft).toBe('pending\n\nnew typing')
    expect(restored).toEqual([taken])
    expect(data?.visible).toEqual(events)
  } finally {
    await act(async () => root.unmount())
  }
})
