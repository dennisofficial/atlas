import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EMcpAuthState } from '../../data/shared/mcp-oauth'
import type { McpOauth } from '../../data/shared/use-mcp-oauth'
import { McpOauthControl } from '../mcp-oauth-control'

const URL_A = 'https://mcp.example.com/mcp'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  await act(async () => mounted.render(node))
  return container
}

const authOf = (state: EMcpAuthState | undefined, signIn = mock(() => {})): McpOauth => ({
  stateOf: () => state,
  isBusy: () => false,
  signIn,
  signOut: () => {},
  reload: () => {},
})

describe('McpOauthControl', () => {
  it('renders nothing before status is known', async () => {
    const view = await render(
      <McpOauthControl serverId="posthog" signInUrl={URL_A} auth={authOf(undefined)} />,
    )
    expect(view.textContent).toBe('')
  })

  it('renders nothing for servers without a sign-in url', async () => {
    const view = await render(
      <McpOauthControl
        serverId="posthog"
        signInUrl={undefined}
        auth={authOf(EMcpAuthState.SignIn)}
      />,
    )
    expect(view.textContent).toBe('')
  })

  it('shows Signed in without a button', async () => {
    const view = await render(
      <McpOauthControl
        serverId="posthog"
        signInUrl={URL_A}
        auth={authOf(EMcpAuthState.SignedIn)}
      />,
    )
    expect(view.textContent).toContain('Signed in')
    expect(view.querySelector('button')).toBeNull()
  })

  it('starts sign-in from the button', async () => {
    const signIn = mock(() => {})
    const view = await render(
      <McpOauthControl
        serverId="posthog"
        signInUrl={URL_A}
        auth={authOf(EMcpAuthState.SignIn, signIn)}
      />,
    )
    const button = view.querySelector('button')
    expect(button?.textContent).toContain('Sign in')
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(signIn).toHaveBeenCalledWith(URL_A)
  })

  it('labels an expired grant Sign in again', async () => {
    const view = await render(
      <McpOauthControl
        serverId="posthog"
        signInUrl={URL_A}
        auth={authOf(EMcpAuthState.SignInAgain)}
      />,
    )
    expect(view.querySelector('button')?.textContent).toContain('Sign in again')
  })
})
