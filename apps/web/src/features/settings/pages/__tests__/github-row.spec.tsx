import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import { browserReturns } from '@dltech/atlas-client/browser-return'
import { EReturnResult } from '@dltech/atlas-core'
import * as realGithubApi from '../../data/personal/github-api'

let sequence = 0
let state = ''
let url = ''
let begins = 0
let disconnects = 0
const open = mock((_url?: string | URL) => null)
mock.module('../../data/personal/github-api', () => ({
  ...realGithubApi,
  beginGithubConnect: async () => {
    begins += 1
    return { url }
  },
  disconnectGithub: async () => {
    disconnects += 1
  },
}))
beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await unregisterDom()
})
beforeEach(() => {
  begins = 0
  disconnects = 0
  open.mockClear()
  window.open = open as unknown as typeof window.open
  state = `github-state-${++sequence}`
  url = `https://api.byatlas.io/return/start/${state}`
})
const roots: { unmount: () => void }[] = []
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.innerHTML = ''
})
const connected = (missingScopes: string[]) => ({
  connected: true as const,
  login: 'octocat',
  scopes: ['repo'],
  missingScopes,
  connectedAt: '2026-01-01T00:00:00.000Z',
})
const mount = async (connection: { connected: false } | ReturnType<typeof connected>) => {
  const reload = mock(() => {})
  const { createRoot } = await import('react-dom/client')
  const { GithubRow } = await import('../integrations')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(<GithubRow connection={connection} reload={reload} />))
  return { reload }
}
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
const click = (label: string) =>
  act(async () => {
    button(label)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })

describe('GithubRow browser redirect', () => {
  it('opens the framework link without a device code and refreshes on return', async () => {
    const { reload } = await mount({ connected: false })
    await click('Connect GitHub')
    expect(open).toHaveBeenCalledWith(
      `${url}?surface=web`,
      `atlas-return-${state}`,
      'noopener,noreferrer',
    )
    expect(document.body.textContent).toContain('Waiting for GitHub')
    expect(document.body.textContent).not.toContain('Copy code')
    await act(async () =>
      browserReturns.remember({ state, outcome: { result: EReturnResult.Connected } }),
    )
    expect(reload).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Waiting for GitHub')
  })
  it('shows a refusal and permits retry', async () => {
    await mount({ connected: false })
    await click('Connect GitHub')
    await act(async () =>
      browserReturns.remember({
        state,
        outcome: { result: EReturnResult.Failed, reason: 'Access denied' },
      }),
    )
    expect(document.body.textContent).toContain('Access denied')
    await click('Retry')
    expect(begins).toBe(2)
  })
  it('offers reconnect with missing scopes', async () => {
    await mount(connected(['workflow', 'admin:ssh_signing_key']))
    expect(document.body.textContent).toContain('workflow, admin:ssh_signing_key')
    await click('Reconnect')
    expect(begins).toBe(1)
  })
  it('ignores a canceled return', async () => {
    const { reload } = await mount({ connected: false })
    await click('Connect GitHub')
    await click('Cancel')
    await act(async () =>
      browserReturns.remember({ state, outcome: { result: EReturnResult.Connected } }),
    )
    expect(reload).not.toHaveBeenCalled()
  })
  it('disconnects and reloads', async () => {
    const { reload } = await mount(connected([]))
    await click('Disconnect')
    expect(disconnects).toBe(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
