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
import { expect } from 'bun:test'
import React from 'react'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { useSettingsGithub, type SettingsGithubControl } from '../use-settings-github'

const URL = 'https://cloud.test'

const CONNECTED_AT = '2026-01-01T00:00:00.000Z'

export type Remote = {
  connected: boolean
  login: string
  down: boolean
  approved: boolean
  denied: boolean
  polls: number
}

export const remote = (): Remote => ({
  connected: false,
  login: 'octocat',
  down: false,
  approved: false,
  denied: false,
  polls: 0,
})

const githubFetch = (state: Remote): typeof fetch => {
  const ok = (data?: unknown) =>
    new Response(JSON.stringify({ result: data === undefined ? {} : { data } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  const failure = (args: { status: number; message: string; code: string }) =>
    new Response(
      JSON.stringify({
        error: {
          message: args.message,
          code: -32603,
          data: { code: args.code, httpStatus: args.status },
        },
      }),
      { status: args.status, headers: { 'content-type': 'application/json' } },
    )

  return (async (input: unknown, init?: RequestInit) => {
    const path = (String(input).slice(URL.length).split('?')[0] ?? '').replace(/^\/v1\/trpc\//, '')
    const method = init?.method ?? 'GET'

    if (state.down) {
      return failure({
        status: 500,
        message: 'cloud is down',
        code: 'INTERNAL_SERVER_ERROR',
      })
    }

    if (path === 'github.get' && method === 'GET') {
      if (!state.connected) return ok({ connected: false })
      return ok({
        connected: true,
        login: state.login,
        scopes: ['repo'],
        connectedAt: CONNECTED_AT,
      })
    }
    if (path === 'github.disconnect' && method === 'POST') {
      state.connected = false
      return ok()
    }
    if (path === 'github.beginConnect' && method === 'POST') {
      return ok({
        deviceCode: 'dev_1',
        userCode: 'ABCD-1234',
        verificationUrl: 'https://github.com/login/device',
        expiresInMs: 60_000,
        intervalMs: 50,
      })
    }
    if (path === 'github.pollConnect' && method === 'POST') {
      state.polls += 1
      if (state.denied) return ok({ status: 'denied' })
      if (!state.approved) return ok({ status: 'pending' })
      state.connected = true
      return ok({ status: 'connected', login: state.login, scopes: ['repo'] })
    }

    return failure({
      status: 404,
      message: `unhandled ${method} ${path}`,
      code: 'NOT_FOUND',
    })
  }) as typeof fetch
}

let directory: string

export function removeDirectory(): void {
  rmSync(directory, { recursive: true, force: true })
}

export const githubCloud = (args: { state: Remote; signedIn?: boolean }): CloudService => {
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

export async function expectUntil(holds: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (holds()) return
    await settle(20)
  }
  expect(holds()).toBe(true)
}

export type Probe = { control: SettingsGithubControl | null }

export function Github(props: {
  cloud: CloudService
  opened: string[]
  probe: Probe
}): React.ReactNode {
  const control = useSettingsGithub({
    cloud: props.cloud,
    minPollIntervalMs: 10,
    openUrl: (url: string) => {
      props.opened.push(url)
    },
  })
  props.probe.control = control

  return <text>{control.flow.status}</text>
}

export type Mounted = {
  probe: Probe
  opened: string[]
  done: () => Promise<void>
}

export async function mounted(args: { cloud: CloudService }): Promise<Mounted> {
  const probe: Probe = { control: null }
  const opened: string[] = []
  const setup = await testRender(<Github cloud={args.cloud} opened={opened} probe={probe} />, {
    width: 60,
    height: 4,
  })
  return { probe, opened, done: () => teardown(setup) }
}

export const controlOf = (probe: Probe): SettingsGithubControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}
