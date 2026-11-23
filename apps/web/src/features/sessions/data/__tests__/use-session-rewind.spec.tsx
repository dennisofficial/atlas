import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { chainEvents, toRunId, toThreadId, type V2Body, type V2Event } from '@dltech/atlas-core'
import type { SessionCommandInput, SessionCommandOutput } from '@dltech/atlas-protocol'

import type { RewindApi } from '../session-rewind'
import { useSessionRewind } from '../use-session-rewind'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const eventsOf = (bodies: readonly V2Body[]) =>
  chainEvents({
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-05T10:00:00.000Z',
    from: undefined,
    bodies,
  })

const eventAt = (events: readonly V2Event[], index: number): V2Event => {
  const event = events[index]
  if (event === undefined) throw new Error('missing event')
  return event
}

const calls: SessionCommandInput[] = []

const recordingApi = (): RewindApi => ({
  command: (input) => {
    calls.push(input)
    return Promise.resolve({ inboxId: 7 })
  },
})

type Deferred = {
  api: RewindApi
  release: () => void
}

const deferredApi = (): Deferred => {
  let resolve: (output: SessionCommandOutput) => void = () => {}
  const api: RewindApi = {
    command: (input) => {
      calls.push(input)
      return new Promise((settle) => {
        resolve = settle
      })
    },
  }
  return { api, release: () => resolve({ inboxId: 7 }) }
}

const mount = async (api: RewindApi) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const handles: { rewind?: ReturnType<typeof useSessionRewind> } = {}
  const events = eventsOf([
    { type: 'user-said', text: 'a' },
    { type: 'user-said', text: 'b' },
    { type: 'background-shell-started', shellId: 'shell-1', command: 'bun test' },
  ])
  function Probe() {
    handles.rewind = useSessionRewind({
      sessionId: 'ses-1',
      events,
      api,
      onRestore: () => {},
    })
    return null
  }
  await act(async () => root.render(<Probe />))
  return {
    events,
    read: () => {
      if (handles.rewind === undefined) throw new Error('not mounted')
      return handles.rewind
    },
    unmount: async () => act(async () => root.unmount()),
  }
}

describe('useSessionRewind dialog', () => {
  it('opens the pick on a rewind request and sends nothing yet', async () => {
    calls.length = 0
    const view = await mount(recordingApi())
    await act(async () => view.read().onRewind({ eventId: eventAt(view.events, 0).id, text: 'a' }))
    expect(calls).toEqual([])
    expect(view.read().dialog.pick).toMatchObject({
      toSeq: 1,
      message: { text: 'a' },
      kills: [{ kind: 'shell', label: 'bun test', running: true }],
    })
    expect(view.read().dialog.applying).toBe(false)
    await view.unmount()
  })

  it('sends the rewind once on confirm and closes the pick', async () => {
    calls.length = 0
    const view = await mount(recordingApi())
    await act(async () => view.read().onRewind({ eventId: eventAt(view.events, 0).id, text: 'a' }))
    await act(async () => {
      await view.read().dialog.onConfirm()
    })
    expect(calls).toEqual([{ sessionId: 'ses-1', name: 'rewind', args: { toSeq: 1 } }])
    expect(view.read().dialog.pick).toBeNull()
    expect(view.read().dialog.applying).toBe(false)
    await view.unmount()
  })

  it('holds applying until the request settles and sends only once', async () => {
    calls.length = 0
    const deferred = deferredApi()
    const view = await mount(deferred.api)
    await act(async () => view.read().onRewind({ eventId: eventAt(view.events, 0).id, text: 'a' }))
    let confirming: Promise<void> | undefined
    await act(async () => {
      confirming = view.read().dialog.onConfirm()
      await Promise.resolve()
    })
    expect(view.read().dialog.applying).toBe(true)
    expect(calls).toHaveLength(1)
    await act(async () => {
      deferred.release()
      await confirming
    })
    expect(view.read().dialog.applying).toBe(false)
    expect(view.read().dialog.pick).toBeNull()
    expect(calls).toHaveLength(1)
    await view.unmount()
  })

  it('sends nothing on cancel', async () => {
    calls.length = 0
    const view = await mount(recordingApi())
    await act(async () => view.read().onRewind({ eventId: eventAt(view.events, 0).id, text: 'a' }))
    await act(async () => view.read().dialog.onCancel())
    expect(calls).toEqual([])
    expect(view.read().dialog.pick).toBeNull()
    await view.unmount()
  })
})
