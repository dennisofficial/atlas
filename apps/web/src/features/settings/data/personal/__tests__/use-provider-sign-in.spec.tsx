import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EOauthProvider, EProviderSignInFlow } from '@dltech/atlas-wire/web'

const begin = mock(async (provider: EOauthProvider) =>
  provider === EOauthProvider.Anthropic
    ? {
        flow: EProviderSignInFlow.PasteCode,
        attemptId: 'paste',
        authorizeUrl: 'https://claude.test/auth',
        expiresInMs: 10000,
      }
    : {
        flow: EProviderSignInFlow.DeviceCode,
        attemptId: 'device',
        userCode: 'ABC',
        verificationUrl: 'https://chatgpt.test/device',
        intervalMs: 100,
        expiresInMs: 10000,
      },
)
mock.module('../provider-sign-in-api', () => ({
  beginProviderSignIn: begin,
  completeProviderSignIn: mock(async () => ({})),
  pollProviderSignIn: mock(async () => ({ status: 'pending' })),
}))

const realFetch = globalThis.fetch
const changed = mock(() => {})
let root: Root | undefined
let calls: string[]
let fallback: number | undefined
let delayStart: boolean
let releaseStart: (value: Response) => void = () => {}
let releaseStatus: (value: Response) => void = () => {}
let realOpen: typeof window.open

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => unregisterDom())
beforeEach(() => {
  calls = []
  fallback = undefined
  delayStart = false
  releaseStatus = () => {}
  changed.mockClear()
  begin.mockClear()
  realOpen = window.open
  window.open = (() => null) as typeof window.open
  Reflect.set(window, 'atlasDesktop', {})
  globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = String(input)
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path.endsWith('/start')) {
      if (fallback !== undefined) return new Response('old host', { status: fallback })
      if (delayStart)
        return new Promise<Response>((resolve) => {
          releaseStart = resolve
        })
      return Response.json({ attemptId: 'desktop-1' })
    }
    if (path.includes('/status?'))
      return new Promise<Response>((resolve) => {
        releaseStatus = resolve
      })
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  globalThis.fetch = realFetch
  window.open = realOpen
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

const mount = async (provider = EOauthProvider.Anthropic) => {
  const { createRoot } = await import('react-dom/client')
  const { useProviderSignIn } = await import('../use-provider-sign-in')
  const { ProviderSignInPanel } = await import('../../../parts/provider-sign-in-panel')
  const Harness = () => {
    const control = useProviderSignIn({ provider, onChanged: changed })
    return (
      <>
        <button type="button" onClick={control.start}>
          Start
        </button>
        <ProviderSignInPanel name="Provider" control={control} />
      </>
    )
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
}
const click = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find((b) => b.textContent === label)
  expect(button).toBeDefined()
  await act(async () => button?.click())
}

describe('provider sign-in on the Mac host', () => {
  it('uses the host loopback and refreshes when the host finishes', async () => {
    await mount()
    await click('Start')
    expect(document.body.textContent).toContain('Finish signing in in your browser')
    expect(calls).toEqual([
      'POST /desktop/provider-sign-in/start',
      'GET /desktop/provider-sign-in/status?attempt=desktop-1',
    ])
    expect(begin).not.toHaveBeenCalled()
    await act(async () => releaseStatus(Response.json({ state: 'signed-in' })))
    expect(changed).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Finish signing in in your browser')
  })

  it.each([EOauthProvider.Anthropic, EOauthProvider.OpenAI])(
    'falls back on an old host for %s',
    async (provider) => {
      fallback = 404
      await mount(provider)
      await click('Start')
      expect(calls[0]).toBe('POST /desktop/provider-sign-in/start')
      expect(begin).toHaveBeenCalledWith(provider)
      expect(document.body.textContent).toContain(
        provider === EOauthProvider.Anthropic ? 'paste the code' : 'ABC',
      )
    },
  )

  it('falls back when the host cannot start the loopback', async () => {
    fallback = 502
    await mount()
    await click('Start')
    expect(begin).toHaveBeenCalledWith(EOauthProvider.Anthropic)
  })

  it('stops the host attempt on cancel and ignores a late completion', async () => {
    await mount()
    await click('Start')
    await click('Cancel')
    expect(calls).toContain('POST /desktop/provider-sign-in/stop')
    await act(async () => releaseStatus(Response.json({ state: 'signed-in' })))
    expect(changed).not.toHaveBeenCalled()
  })

  it('stops the host attempt on unmount', async () => {
    await mount()
    await click('Start')
    await act(async () => root?.unmount())
    root = undefined
    expect(calls).toContain('POST /desktop/provider-sign-in/stop')
  })

  it('uses the existing flow without a desktop bridge', async () => {
    Reflect.deleteProperty(window, 'atlasDesktop')
    await mount()
    await click('Start')
    expect(calls).toEqual([])
    expect(begin).toHaveBeenCalledWith(EOauthProvider.Anthropic)
  })

  it('stops an attempt that begins after the page unmounted', async () => {
    delayStart = true
    await mount()
    await click('Start')
    await act(async () => root?.unmount())
    root = undefined
    await act(async () => releaseStart(Response.json({ attemptId: 'desktop-1' })))
    expect(calls).toEqual([
      'POST /desktop/provider-sign-in/start',
      'POST /desktop/provider-sign-in/stop',
    ])
    expect(begin).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })

  it('shows the host failure without starting another sign-in', async () => {
    await mount()
    await click('Start')
    await act(async () =>
      releaseStatus(Response.json({ state: 'failed', reason: 'access_denied' })),
    )
    expect(document.body.textContent).toContain('access_denied')
    expect(begin).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
  })
})
