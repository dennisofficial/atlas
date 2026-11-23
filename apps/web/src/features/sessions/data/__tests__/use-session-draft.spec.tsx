import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act, useState } from 'react'

import type { Attachment } from '@dltech/atlas-core'
import type { DraftContent } from '@dltech/atlas-client/session'

import type { SessionDraftsApi } from '../session-drafts-api'
import { useSessionDraft } from '../use-session-draft'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

const SESSION = 'ses-1'

const EMPTY: readonly Attachment[] = []

const storedContent = (text: string): DraftContent => ({
  text,
  attachments: [
    {
      id: 'media:abc',
      name: 'diagram.png',
      mediaType: 'image/png',
      size: 12,
      content: { store: 'media', hash: 'abc' },
    },
  ],
})

type Recorder = {
  puts: DraftContent[]
  clears: (string | null)[]
  gets: (string | null)[]
}

const recorderOf = (): Recorder => ({ puts: [], clears: [], gets: [] })

const fakeApi = (args: { stored: DraftContent | null; calls: Recorder }): SessionDraftsApi => ({
  get: (sessionId) => {
    args.calls.gets.push(sessionId)
    return Promise.resolve(args.stored)
  },
  put: (put) => {
    args.calls.puts.push(put.content)
    return Promise.resolve()
  },
  clear: (sessionId) => {
    args.calls.clears.push(sessionId)
    return Promise.resolve()
  },
})

const deferredApi = (args: { calls: Recorder }) => {
  let release: (stored: DraftContent | null) => void = () => {}
  const api: SessionDraftsApi = {
    get: (sessionId) => {
      args.calls.gets.push(sessionId)
      return new Promise((resolve) => {
        release = resolve
      })
    },
    put: (put) => {
      args.calls.puts.push(put.content)
      return Promise.resolve()
    },
    clear: (sessionId) => {
      args.calls.clears.push(sessionId)
      return Promise.resolve()
    },
  }
  return { api, release: (stored: DraftContent | null) => release(stored) }
}

type Handles = {
  draft?: string
  restored?: DraftContent
  handleSent?: (text: string) => void
  setDraft?: (text: string) => void
}

const settle = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

const mount = async (api: SessionDraftsApi) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const handles: Handles = {}
  function Probe() {
    const [draft, setDraft] = useState('')
    const drafts = useSessionDraft({
      sessionId: SESSION,
      text: draft,
      attachments: EMPTY,
      onRestore: (stored) => {
        handles.restored = stored
        setDraft(stored.text)
      },
      api,
    })
    handles.draft = draft
    handles.setDraft = setDraft
    handles.handleSent = drafts.handleSent
    return <p>{draft}</p>
  }
  await act(async () => root.render(<Probe />))
  const type = (text: string) =>
    act(async () => {
      handles.setDraft?.(text)
    })
  const unmount = () => act(async () => root.unmount())
  return { host, handles, type, unmount }
}

describe('useSessionDraft', () => {
  it('restores a stored draft into an empty composer', async () => {
    const calls = recorderOf()
    const stored = storedContent('half-typed')
    const view = await mount(fakeApi({ stored, calls }))
    await settle()

    expect(calls.gets).toEqual([SESSION])
    expect(view.handles.draft).toBe('half-typed')
    expect(view.handles.restored).toEqual(stored)
    expect(view.host.textContent).toBe('half-typed')
    await view.unmount()
  })

  it('does not overwrite text typed before the stored draft arrives', async () => {
    const calls = recorderOf()
    const pending = deferredApi({ calls })
    const view = await mount(pending.api)
    await view.type('mine')

    await act(async () => {
      pending.release(storedContent('theirs'))
    })
    await settle()

    expect(view.handles.draft).toBe('mine')
    await view.unmount()
  })

  it('flushes a pending write when the page becomes hidden', async () => {
    const calls = recorderOf()
    const view = await mount(fakeApi({ stored: null, calls }))
    await settle()
    await view.type('leaving soon')

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await settle()

    expect(calls.puts).toEqual([{ text: 'leaving soon', attachments: [] }])
    await view.unmount()
  })

  it('flushes a pending write on unmount', async () => {
    const calls = recorderOf()
    const view = await mount(fakeApi({ stored: null, calls }))
    await settle()
    await view.type('pending')

    await view.unmount()
    await settle()

    expect(calls.puts).toEqual([{ text: 'pending', attachments: [] }])
  })

  it('clears the stored draft after a successful send', async () => {
    const calls = recorderOf()
    const view = await mount(fakeApi({ stored: null, calls }))
    await settle()
    await view.type('go')

    await act(async () => {
      view.handles.handleSent?.('go')
    })
    await settle()

    expect(calls.clears).toEqual([SESSION])
    expect(calls.puts).toEqual([])
    await view.unmount()
  })
})
