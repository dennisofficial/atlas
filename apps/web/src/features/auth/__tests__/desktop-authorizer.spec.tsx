import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

const replace = mock((_href: string) => {})
const assign = mock((_href: string) => {})
let search = ''
mock.module('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/desktop/authorize',
  useSearchParams: () => new URLSearchParams(search),
}))

const realFetch = globalThis.fetch
const REDIRECT = 'http://127.0.0.1:5000/desktop/auth/callback'
let signedIn = false
let minted: unknown[] = []

const query = (redirect = REDIRECT) =>
  new URLSearchParams({
    redirect_uri: redirect,
    state: 'st',
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
  }).toString()

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'location', { value: { assign }, configurable: true })
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
beforeEach(() => {
  replace.mockClear()
  assign.mockClear()
  minted = []
  signedIn = false
  globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/auth/get-session')) {
      return Response.json(signedIn ? { user: { name: 'a', email: 'a@b.c', image: null } } : null)
    }
    if (url.endsWith('/v1/trpc/desktopAuth.authorize')) {
      minted.push(JSON.parse(String(init?.body)))
      return Response.json({ result: { data: { code: 'the-code' } } })
    }
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  document.body.innerHTML = ''
})

const mount = async () => {
  const { createRoot } = await import('react-dom/client')
  const { DesktopAuthorizer } = await import('../desktop-authorizer')
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => createRoot(container).render(<DesktopAuthorizer />))
  await act(async () => {})
  await act(async () => {})
}

describe('DesktopAuthorizer', () => {
  it('redirects to the loopback with code and state when signed in', async () => {
    search = query()
    signedIn = true
    await mount()
    expect(minted).toEqual([
      { redirectUri: REDIRECT, codeChallenge: 'c'.repeat(43), codeChallengeMethod: 'S256' },
    ])
    expect(assign).toHaveBeenCalledWith(`${REDIRECT}?code=the-code&state=st`)
  })

  it('sends a signed-out visitor to sign-in with next back to itself', async () => {
    search = query()
    await mount()
    expect(assign).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(
      `/sign-in?next=${encodeURIComponent(`/desktop/authorize?${query()}`)}`,
    )
  })

  it('refuses a non-loopback redirect_uri', async () => {
    search = query('https://evil.test/desktop/auth/callback')
    signedIn = true
    await mount()
    expect(minted).toEqual([])
    expect(assign).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('invalid')
  })
})
