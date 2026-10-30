import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

const replace = mock((_href: string) => {})
let search = ''
mock.module('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/sign-in',
  useSearchParams: () => new URLSearchParams(search),
}))

const realFetch = globalThis.fetch
let calls: string[]
let statuses: unknown[]

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
beforeEach(() => {
  calls = []
  statuses = []
  search = ''
  replace.mockClear()
  globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    calls.push(key)
    if (key === 'POST /desktop/auth/start') {
      return Response.json({
        authorizeUrl: 'https://byatlas.io/desktop/authorize?x=1',
      })
    }
    if (key === 'GET /desktop/auth/status')
      return Response.json(statuses.shift() ?? { state: 'pending' })
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

const mount = async () => {
  const { createRoot } = await import('react-dom/client')
  const { SignInForm } = await import('../sign-in-form')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<SignInForm />))
  await act(async () => {})
  return root
}

const click = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  )
  await act(async () => button?.click())
  await act(async () => {})
}
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('desktop sign-in gating', () => {
  it('keeps the web form without the desktop bridge', async () => {
    await mount()
    expect(document.body.textContent).toContain('Continue with Google')
    expect(document.body.textContent).not.toContain('Continue in browser')
  })

  it('swaps in Continue in browser on desktop', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    await mount()
    expect(document.body.textContent).toContain('Continue in browser')
    expect(document.body.textContent).not.toContain('Continue with Google')
    expect(document.querySelector('input')).toBeNull()
  })
})

describe('desktop sign-in polling', () => {
  const desktopMount = async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    const { DesktopSignIn } = await import('../desktop-sign-in')
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () =>
      createRoot(container).render(
        <DesktopSignIn title="t" description="d" next={null} pollMs={5} />,
      ),
    )
  }

  it('shows the browser prompt, polls, and redirects to /threads when signed in', async () => {
    statuses = [{ state: 'pending' }, { state: 'signed-in', email: 'a@b.c' }]
    await desktopMount()
    await click('Continue in browser')
    expect(document.body.textContent).toContain('Finish signing in in your browser')
    expect(document.body.textContent).not.toContain('Enter this code')
    await wait(60)
    expect(calls.filter((c) => c === 'GET /desktop/auth/status').length).toBeGreaterThanOrEqual(2)
    expect(replace).toHaveBeenCalledWith('/threads')
  })

  it('cancel returns to the button', async () => {
    await desktopMount()
    await click('Continue in browser')
    await click('Cancel')
    expect(document.body.textContent).toContain('Continue in browser')
  })

  it('offers retry when sign-in times out', async () => {
    statuses = [{ state: 'expired' }]
    await desktopMount()
    await click('Continue in browser')
    await wait(40)
    expect(document.body.textContent).toContain('Sign-in timed out')
    expect(document.body.textContent).toContain('Try again')
    expect(replace).not.toHaveBeenCalled()
  })

  it('reports denial', async () => {
    statuses = [{ state: 'denied' }]
    await desktopMount()
    await click('Continue in browser')
    await wait(40)
    expect(document.body.textContent).toContain('Sign-in denied')
  })
})
