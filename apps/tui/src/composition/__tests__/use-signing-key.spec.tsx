import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CloudService,
  CloudSessionStore,
  memoryAccountStore,
  SystemClock,
} from '@dltech/atlas-harness'
import { SSH_SIGNING_SCOPE_NOTICE } from '@dltech/atlas-wire'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { ESigningKeyView } from '../../ui/components/settings/signing-key-row'
import { clearNotice, currentNotices } from '../../ui/notice-store'
import { useSigningKey, type SigningKeyControl } from '../use-signing-key'

const URL = 'https://cloud.test'
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJ'
const SCOPE_KEY = 'signing-scope-missing'

type Remote = {
  registered: boolean
  scopeMissing: boolean
  down: boolean
  githubConnected: boolean
  calls: string[]
}

const remote = (): Remote => ({ registered: false, scopeMissing: false, down: false, githubConnected: false, calls: [] })

const keyFetch = (state: Remote): typeof fetch => {
  const reply = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const statusBody = () =>
    state.registered
      ? { state: 'registered', publicKey: PUBLIC_KEY, createdAt: '2026-01-01T00:00:00.000Z' }
      : { state: 'absent' }

  return (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const call = `${init?.method ?? 'GET'} ${path}`
    state.calls.push(call)

    if (state.down) return reply(500, { message: 'cloud is down' })
    if (call === 'GET /v1/github') {
      return reply(
        200,
        state.githubConnected
          ? { connected: true, login: 'octocat', scopes: ['repo'], connectedAt: '2026-01-01T00:00:00.000Z' }
          : { connected: false },
      )
    }
    if (call === 'GET /v1/ssh-signing-key/status') return reply(200, statusBody())
    if (call === 'POST /v1/ssh-signing-key' || call === 'POST /v1/ssh-signing-key/rotate') {
      if (state.scopeMissing) {
        return reply(403, { message: SSH_SIGNING_SCOPE_NOTICE, code: 'github-signing-scope-missing' })
      }
      state.registered = true
      return reply(call.endsWith('rotate') ? 200 : 201, statusBody())
    }
    if (call === 'DELETE /v1/ssh-signing-key') {
      state.registered = false
      return reply(204)
    }
    return reply(404, { message: `unhandled ${call}` })
  }) as typeof fetch
}

let directory: string

const cloudOf = (state: Remote): CloudService => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-signing-key-'))
  const sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  sessions.write({ url: URL, token: 'sess_key', email: 'dev@example.com' })
  return new CloudService({
    sessions,
    localAccounts: memoryAccountStore({ clock: new SystemClock() }),
    defaultUrl: URL,
    fetchFn: keyFetch(state),
  })
}

afterEach(() => {
  clearNotice({ key: SCOPE_KEY })
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

type Probe = { control: SigningKeyControl | null }

function Key(props: {
  cloud: CloudService
  state: Remote
  login: string | null
  probe: Probe
}): React.ReactNode {
  const control = useSigningKey({
    cloud: props.cloud,
    githubLogin: props.login,
    fetchFn: keyFetch(props.state),
  })
  props.probe.control = control
  return <text>{control.view.state}</text>
}

const controlOf = (probe: Probe): SigningKeyControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}

async function mounted(args: { state: Remote; login: string | null }) {
  const probe: Probe = { control: null }
  const cloud = cloudOf(args.state)
  const setup = await testRender(
    <Key cloud={cloud} state={args.state} login={args.login} probe={probe} />,
    { width: 40, height: 4 },
  )
  return { probe, done: () => teardown(setup) }
}

const count = (state: Remote, call: string): number => state.calls.filter((entry) => entry === call).length

describe('useSigningKey', () => {
  it('registers a key once GitHub has a login and reports the fingerprint tail', async () => {
    const state = remote()
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      expect(controlOf(probe).view.fingerprintTail).toBe('CDEFGHIJ')
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('registers once on boot when GitHub is already connected, and not again for the same login', async () => {
    const state = remote()
    state.githubConnected = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      await settle(100)
      expect(count(state, 'GET /v1/github')).toBeGreaterThan(0)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('registers from the boot check alone when the settings login has not arrived', async () => {
    const state = remote()
    state.githubConnected = true
    const { probe, done } = await mounted({ state, login: null })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })

  it('does not register without a GitHub login', async () => {
    const state = remote()
    const { probe, done } = await mounted({ state, login: null })

    try {
      await settle(100)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(0)
      expect(controlOf(probe).view.state).toBe(ESigningKeyView.Absent)
    } finally {
      await done()
    }
  })

  it('leaves an existing key alone and registers nothing', async () => {
    const state = remote()
    state.registered = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      expect(count(state, 'POST /v1/ssh-signing-key')).toBe(0)
    } finally {
      await done()
    }
  })

  it('raises the scope notice and reads scope-missing when GitHub lacks the scope', async () => {
    const state = remote()
    state.scopeMissing = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.ScopeMissing)
      expect(currentNotices().map((notice) => notice.text)).toContain(SSH_SIGNING_SCOPE_NOTICE)
    } finally {
      await done()
    }
  })

  it('maps an unreachable cloud to the unavailable view on refresh', async () => {
    const state = remote()
    state.down = true
    const { probe, done } = await mounted({ state, login: null })

    try {
      controlOf(probe).refresh()
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Unavailable)
    } finally {
      await done()
    }
  })

  it('rotates and then removes, announcing each', async () => {
    const state = remote()
    state.registered = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)

      controlOf(probe).activateRotateOrEnable()
      await expectUntil(() => count(state, 'POST /v1/ssh-signing-key/rotate') === 1)
      await expectUntil(() => currentNotices().some((n) => n.text === 'commit signing key rotated'))

      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      controlOf(probe).activateRemove()
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Absent)
      expect(currentNotices().some((n) => n.text === 'commit signing key removed')).toBe(true)
    } finally {
      await done()
    }
  })

  it('ignores a second remove while the first is in flight', async () => {
    const state = remote()
    state.registered = true
    const { probe, done } = await mounted({ state, login: 'octocat' })

    try {
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Registered)
      const control = controlOf(probe)

      control.activateRemove()
      control.activateRemove()
      await expectUntil(() => controlOf(probe).view.state === ESigningKeyView.Absent)

      expect(count(state, 'DELETE /v1/ssh-signing-key')).toBe(1)
    } finally {
      await done()
    }
  })
})
