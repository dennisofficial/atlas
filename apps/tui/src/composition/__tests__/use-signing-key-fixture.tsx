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
import React from 'react'

import { settle } from '../../ui/markdown/__tests__/harness'
import { useSigningKey, type SigningKeyControl } from '../use-signing-key'

export const URL = 'https://cloud.test'
export const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIABCDEFGHIJ'
export const SCOPE_KEY = 'signing-scope-missing'

export type Remote = {
  registered: boolean
  scopeMissing: boolean
  down: boolean
  githubConnected: boolean
  gate: Promise<void> | null
  calls: string[]
}

export const remote = (): Remote => ({
  registered: false,
  scopeMissing: false,
  down: false,
  githubConnected: false,
  gate: null,
  calls: [],
})

export const keyFetch = (state: Remote): typeof fetch => {
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

    if (state.gate !== null) await state.gate
    if (state.down) return reply(500, { message: 'cloud is down' })
    if (call === 'GET /v1/github') {
      return reply(
        200,
        state.githubConnected
          ? {
              connected: true,
              login: 'octocat',
              scopes: ['repo'],
              connectedAt: '2026-01-01T00:00:00.000Z',
            }
          : { connected: false },
      )
    }
    if (call === 'GET /v1/ssh-signing-key/status') return reply(200, statusBody())
    if (call === 'POST /v1/ssh-signing-key' || call === 'POST /v1/ssh-signing-key/rotate') {
      if (state.scopeMissing) {
        return reply(403, {
          message: SSH_SIGNING_SCOPE_NOTICE,
          code: 'github-signing-scope-missing',
        })
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

const directories: string[] = []

export const cloudOf = (state: Remote): CloudService => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-signing-key-'))
  directories.push(directory)
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

export const removeDirectories = (): void => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

export async function expectUntil(holds: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (holds()) return
    await settle(20)
  }
  if (!holds()) throw new Error('the condition never held')
}

export type Probe = { control: SigningKeyControl | null }

export function Key(props: {
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

export const controlOf = (probe: Probe): SigningKeyControl => {
  if (probe.control === null) throw new Error('the probe never mounted')
  return probe.control
}

export const count = (state: Remote, call: string): number =>
  state.calls.filter((entry) => entry === call).length
