import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { V2Event } from '@dltech/atlas-core'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { useStagedMessages } from '../use-staged-messages'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

type Handles = {
  stage?: ReturnType<typeof useStagedMessages>['stage']
  transcript?: readonly string[]
}

const mount = async (args: { sessionId: string; events?: readonly V2Event[] }) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const handles: Handles = {}
  function Probe({ events }: { events: readonly V2Event[] }) {
    const staged = useStagedMessages({
      sessionId: args.sessionId,
      events,
      working: false,
      draft: '',
      onDraftChange: () => {},
    })
    handles.stage = staged.stage
    handles.transcript = staged.transcript.map((entry) => entry.clientId)
    return <p>{handles.transcript.join(',')}</p>
  }
  const render = async (events: readonly V2Event[]): Promise<void> => {
    await act(async () => root.render(<Probe events={events} />))
  }
  await render(args.events ?? [])
  return { host, root, handles, render }
}

describe('useStagedMessages', () => {
  it('keeps a staged message after the view unmounts and mounts again', async () => {
    const first = await mount({ sessionId: 'kept-1' })
    await act(async () => first.handles.stage?.({ clientId: 'c1', text: 'hello', attachments: [] }))
    expect(first.host.textContent).toBe('c1')
    await act(async () => first.root.unmount())

    const second = await mount({ sessionId: 'kept-1' })
    expect(second.host.textContent).toBe('c1')
    await act(async () => second.root.unmount())
  })

  it('keeps each session to its own staged messages', async () => {
    const first = await mount({ sessionId: 'isolated-1' })
    await act(async () => first.handles.stage?.({ clientId: 'a1', text: 'one', attachments: [] }))
    const second = await mount({ sessionId: 'isolated-2' })
    expect(second.host.textContent).toBe('')
    await act(async () => second.handles.stage?.({ clientId: 'b1', text: 'two', attachments: [] }))
    expect(first.host.textContent).toBe('a1')
    expect(second.host.textContent).toBe('b1')
    await act(async () => first.root.unmount())
    await act(async () => second.root.unmount())
  })

  it('drops a staged message once an event confirms it', async () => {
    const view = await mount({ sessionId: 'settled-1' })
    await act(async () => view.handles.stage?.({ clientId: 's1', text: 'hello', attachments: [] }))
    expect(view.host.textContent).toBe('s1')
    await view.render(
      mintEvents({ bodies: [{ type: 'user-said', text: 'hello', clientId: 's1' }] }),
    )
    expect(view.host.textContent).toBe('')
    await act(async () => view.root.unmount())
  })
})
