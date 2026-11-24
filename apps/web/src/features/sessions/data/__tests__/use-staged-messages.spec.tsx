import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { pendingInputsOf, type V2Event } from '@dltech/atlas-core'
import { EOutgoingPlacement } from '@dltech/atlas-client/stream'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { useStagedMessages } from '../use-staged-messages'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const AT = '2026-11-23T10:00:00.000Z'

const stagedOf = (clientId: string, text: string) => ({
  clientId,
  text,
  attachments: [],
  placement: EOutgoingPlacement.Transcript,
  at: AT,
})

type Handles = {
  stage?: ReturnType<typeof useStagedMessages>['stage']
  staged?: readonly string[]
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
      pending: pendingInputsOf(events),
      draft: '',
      onDraftChange: () => {},
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
})
