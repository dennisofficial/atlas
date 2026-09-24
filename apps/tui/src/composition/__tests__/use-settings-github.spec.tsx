import { afterEach, describe, expect, it, jest } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CloudService,
  CloudSessionStore,
  memoryAccountStore,
  SystemClock,
} from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { ESettingsLogin } from '../../ui/settings-login-model'
import { useSettingsGithub, type SettingsGithubControl } from '../use-settings-github'

const URL = 'https://cloud.test'

const CONNECTED_AT = '2026-01-01T00:00:00.000Z'

type Remote = {
  connected: boolean
  login: string
  down: boolean
  approved: boolean
  denied: boolean
  polls: number
}

const remote = (): Remote => ({
  connected: false,
  login: 'octocat',
  down: false,
  approved: false,
  denied: false,
  polls: 0,
})

const githubFetch = (state: Remote): typeof fetch => {
  const reply = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  return (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'

    if (state.down) return reply(500, { message: 'cloud is down' })

    if (path === '/v1/github' && method === 'GET') {
      if (!state.connected) return reply(200, { connected: false })
      return reply(200, {
        connected: true,
        login: state.login,
        scopes: ['repo'],
        connectedAt: CONNECTED_AT,
      })
    }
    if (path === '/v1/github' && method === 'DELETE') {
      state.connected = false
      return reply(204)
    }
    if (path === '/v1/github/connect/begin' && method === 'POST') {
      return reply(200, {
        deviceCode: 'dev_1',
        userCode: 'ABCD-1234',
        verificationUrl: 'https://github.com/login/device',
        expiresInMs: 60_000,
        intervalMs: 50,
      })
    }
    if (path === '/v1/github/connect/poll' && method === 'POST') {
      state.polls += 1
      if (state.denied) return reply(200, { status: 'denied' })
      if (!state.approved) return reply(200, { status: 'pending' })
      state.connected = true
      return reply(200, { status: 'connected', login: state.login, scopes: ['repo'] })
    }

    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch
}

let directory: string

const githubCloud = (args: { state: Remote; signedIn?: boolean }): CloudService => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-gh-settings-'))
  const sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  if (args.signedIn !== false) {
    sessions.write({ url: URL, token: 'sess_gh', email: 'dev@example.com' })
  }
  return new CloudService({
    sessions,
    localAccounts: memoryAccountStore({ clock: new SystemClock() }),
    defaultUrl: URL,
    fetchFn: githubFetch(args.state),
  })
}

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

async function expectUntil(holds: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (holds()) return
    await settle(20)
  }
  expect(holds()).toBe(true)
}

/**
 * The hook clamps the device-flow poll to a 3s minimum (use-settings-github.ts), so the flow tests
 * run on fake timers: advancing past the clamp fires the poll instantly, and macrotask drains let
 * the fetch promises and React commits land without waiting out the real clock.
 */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => resolve()
      channel.port2.postMessage(0)
    })
  }
}

type Probe = { control: SettingsGithubControl | null }

function Github(props: { cloud: CloudService; opened: string[]; probe: Probe }): React.ReactNode {
  const control = useSettingsGithub({
    cloud: props.cloud,
    openUrl: (url: string) => {
      props.opened.push(url)
    },
  })
  props.probe.control = control

  return <text>{control.flow.status}</text>
}

type Mounted = { probe: Probe; opened: string[]; done: () => Promise<void> }

async function mounted(args: { cloud: CloudService }): Promise<Mounted> {
  const probe: Probe = { control: null }
  const opened: string[] = []
  const setup = await testRender(<Github cloud={args.cloud} opened={opened} probe={probe} />, {
    width: 60,
    height: 4,
  })
  return { probe, opened, done: () => teardown(setup) }
}

const controlOf = (probe: Probe): SettingsGithubControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}

describe('useSettingsGithub', () => {
  it('loads the stored connection on refresh', async () => {
    const state = remote()
    state.connected = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).connection?.login === 'octocat')
      expect(controlOf(probe).unreachable).toBe(false)
    } finally {
      await done()
    }
  })

  it('marks the row unreachable when the cloud cannot be reached', async () => {
    const state = remote()
    state.down = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).unreachable)
      expect(controlOf(probe).connection).toBeNull()
    } finally {
      await done()
    }
  })

  it('stays disconnected without a cloud session', async () => {
    const state = remote()
    const { probe, done } = await mounted({ cloud: githubCloud({ state, signedIn: false }) })

    try {
      controlOf(probe).refresh()
      await settle(100)

      expect(controlOf(probe).connection).toBeNull()
      expect(controlOf(probe).unreachable).toBe(false)
    } finally {
      await done()
    }
  })

  it('runs the device flow and lands the connection', async () => {
    const state = remote()
    const { probe, opened, done } = await mounted({ cloud: githubCloud({ state }) })

    jest.useFakeTimers()
    try {
      controlOf(probe).activate()
      await drain()
      expect(controlOf(probe).flow.status).toBe(ESettingsLogin.Prompting)
      expect(controlOf(probe).flow.prompt?.userCode).toBe('ABCD-1234')
      expect(opened).toEqual(['https://github.com/login/device'])

      state.approved = true
      jest.advanceTimersByTime(3_000)
      await drain()
      const notice = 'Connected GitHub as @octocat.'
      expect(controlOf(probe).flow.notice).toBe(notice)
      expect(controlOf(probe).connection?.login).toBe('octocat')
    } finally {
      jest.useRealTimers()
      controlOf(probe).stop()
      await done()
    }
  }, 30_000)

  it('stop cancels the poll', async () => {
    const state = remote()
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    jest.useFakeTimers()
    try {
      controlOf(probe).activate()
      await drain()
      expect(controlOf(probe).flow.status).toBe(ESettingsLogin.Prompting)

      controlOf(probe).stop()
      await drain()
      expect(controlOf(probe).flow.status).toBe(ESettingsLogin.Idle)
      const pollsAtStop = state.polls
      jest.advanceTimersByTime(10_000)
      await drain()

      expect(state.polls).toBe(pollsAtStop)
    } finally {
      jest.useRealTimers()
      await done()
    }
  }, 30_000)

  it('ends the flow with failure text when the connection is refused', async () => {
    const state = remote()
    state.denied = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    jest.useFakeTimers()
    try {
      controlOf(probe).activate()
      await drain()
      const failure = 'that connection was refused.'
      jest.advanceTimersByTime(3_000)
      await drain()
      expect(controlOf(probe).flow.failure).toBe(failure)
    } finally {
      jest.useRealTimers()
      controlOf(probe).stop()
      await done()
    }
  }, 30_000)

  it('disconnects when activated while connected', async () => {
    const state = remote()
    state.connected = true
    const { probe, done } = await mounted({ cloud: githubCloud({ state }) })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).connection !== null)

      controlOf(probe).activate()
      await expectUntil(() => controlOf(probe).flow.notice === 'Disconnected GitHub.')
      await expectUntil(() => controlOf(probe).connection === null)
      expect(state.connected).toBe(false)
    } finally {
      await done()
    }
  }, 30_000)
})
