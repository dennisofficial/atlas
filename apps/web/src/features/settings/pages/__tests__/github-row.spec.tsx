import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { EGithubPollStatus, type GithubPollResult } from '@dltech/atlas-wire/web'

import * as realGithubApi from '../../data/personal/github-api'

const codes = {
  deviceCode: 'dc',
  userCode: 'ABCD-1234',
  verificationUrl: 'https://github.com/login/device',
  expiresInMs: 60_000,
  intervalMs: 5,
}

let pollResults: GithubPollResult[]
let begins: number
let disconnects: number
let beginCodes = codes
const open = mock((_url?: string | URL) => null)

mock.module('../../data/personal/github-api', () => ({
  ...realGithubApi,
  beginGithubConnect: async () => {
    begins += 1
    return beginCodes
  },
  pollGithubConnect: async () => pollResults.shift() ?? { status: EGithubPollStatus.Pending },
  disconnectGithub: async () => {
    disconnects += 1
  },
}))

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})
beforeEach(() => {
  pollResults = []
  begins = 0
  disconnects = 0
  beginCodes = codes
  open.mockClear()
  window.open = open as unknown as typeof window.open
})
const roots: { unmount: () => void }[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.innerHTML = ''
})

type Connection = { connected: false } | ReturnType<typeof connected>

const connected = (missingScopes: string[]) => ({
  connected: true as const,
  login: 'octocat',
  scopes: ['repo'],
  missingScopes,
  connectedAt: '2026-01-01T00:00:00.000Z',
})

const settle = (ms = 40) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

const mount = async (connection: Connection) => {
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

describe('GithubRow', () => {
  it('connects: shows the code, opens GitHub, reloads on approval', async () => {
    pollResults = [{ status: EGithubPollStatus.Connected, login: 'octocat', scopes: ['repo'] }]
    const { reload } = await mount({ connected: false })
    expect(button('Reconnect')).toBeUndefined()
    beginCodes = { ...codes, intervalMs: 200 }
    await click('Connect GitHub')
    await settle(1)
    expect(document.body.textContent).toContain('ABCD-1234')
    expect(open).toHaveBeenCalledWith(codes.verificationUrl, '_blank', 'noopener')
    await settle(300)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('ABCD-1234')
  })

  it('offers Reconnect and names the missing scopes', async () => {
    await mount(connected(['workflow', 'admin:ssh_signing_key']))
    expect(document.body.textContent).toContain('workflow, admin:ssh_signing_key')
    await click('Reconnect')
    expect(begins).toBe(1)
  })

  it('does not prompt when every scope is granted', async () => {
    await mount(connected([]))
    expect(button('Reconnect')).toBeDefined()
    expect(document.body.textContent).not.toContain('Reconnect to grant')
  })

  it('keeps waiting through slow_down', async () => {
    pollResults = [
      { status: EGithubPollStatus.SlowDown },
      { status: EGithubPollStatus.Connected, login: 'octocat', scopes: ['repo'] },
    ]
    const { reload } = await mount({ connected: false })
    await click('Connect GitHub')
    await settle(40)
    expect(reload).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Waiting for approval')
  })

  it('shows an expired error with retry', async () => {
    beginCodes = { ...codes, expiresInMs: 1 }
    await mount({ connected: false })
    await click('Connect GitHub')
    await settle()
    expect(document.body.textContent).toContain('That code expired')
    await click('Retry')
    expect(begins).toBe(2)
  })

  it('disconnects and reloads', async () => {
    const { reload } = await mount(connected([]))
    await click('Disconnect')
    await settle(5)
    expect(disconnects).toBe(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
