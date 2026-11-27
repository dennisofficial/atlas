import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { toast } from 'sonner'

import { EReturnResult } from '@dltech/atlas-core'
import { browserReturns } from '@dltech/atlas-client/browser-return'

import { rememberMcpSignIn } from '../../data/shared/mcp-signin-attempts'

const createToastSpies = () => ({
  success: spyOn(toast, 'success').mockImplementation(() => 0),
  error: spyOn(toast, 'error').mockImplementation(() => 0),
})

let toastSpies: ReturnType<typeof createToastSpies>
let root: Root | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(() => {
  toastSpies = createToastSpies()
})

afterEach(async () => {
  try {
    const mounted = root
    if (mounted !== null) await act(async () => mounted.unmount())
  } finally {
    root = null
    toastSpies.success.mockRestore()
    toastSpies.error.mockRestore()
  }
})

async function mountResult(reload: () => void) {
  const { McpOauthResult } = await import('../mcp-oauth-result')
  const { createRoot } = await import('react-dom/client')
  root = createRoot(document.createElement('div'))
  const mounted = root
  await act(async () => mounted.render(<McpOauthResult reload={reload} />))
}

describe('McpOauthResult', () => {
  it('toasts the outcome the return window remembered and reloads once', async () => {
    rememberMcpSignIn({ state: 'web-state-1', label: 'mcp.example.com' })
    browserReturns.remember({ state: 'web-state-1', outcome: { result: EReturnResult.Connected } })
    let reloads = 0
    await mountResult(() => {
      reloads += 1
    })

    expect(toastSpies.success).toHaveBeenCalledWith('Signed in to mcp.example.com')
    expect(reloads).toBe(1)
  })

  it('toasts a failure with the reason', async () => {
    rememberMcpSignIn({ state: 'web-state-2', label: 'a.test' })
    browserReturns.remember({
      state: 'web-state-2',
      outcome: { result: EReturnResult.Failed, reason: 'denied' },
    })
    await mountResult(() => {})

    expect(toastSpies.error).toHaveBeenCalledWith("Couldn't sign in to a.test: denied")
  })

  it('stays quiet for a state with no remembered outcome', async () => {
    rememberMcpSignIn({ state: 'web-state-3', label: 'quiet.test' })
    await mountResult(() => {})

    expect(toastSpies.success).not.toHaveBeenCalled()
    expect(toastSpies.error).not.toHaveBeenCalled()
  })

  it('does not toast the same result a second time', async () => {
    rememberMcpSignIn({ state: 'web-state-4', label: 'once.test' })
    browserReturns.remember({ state: 'web-state-4', outcome: { result: EReturnResult.Connected } })
    await mountResult(() => {})
    expect(toastSpies.success).toHaveBeenCalledTimes(1)

    const mounted = root
    if (mounted !== null) await act(async () => mounted.unmount())
    root = null
    await mountResult(() => {})

    expect(toastSpies.success).toHaveBeenCalledTimes(1)
  })
})
