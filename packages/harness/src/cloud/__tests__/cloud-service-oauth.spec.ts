import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAuthKind, EAuthProvider, EAccountOrigin, type ClockPort } from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { CloudService } from '../cloud-service'
import { CloudSessionStore, type CloudSession } from '../cloud-session'
import type { CloudLoginTicket } from '../device-login'

const directories: string[] = []
const clock: ClockPort = { now: () => '2026-10-05T12:00:00.000Z' }
const ticket: CloudLoginTicket = {
  url: 'https://cloud.test',
  deviceCode: 'fake-device',
  userCode: 'fake-code',
  verificationUrl: 'https://cloud.test/device',
  expiresInMs: 60_000,
  intervalMs: 1_000,
}

const setup = (handoffOauth: (session: CloudSession) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-oauth-signin-'))
  directories.push(directory)
  const sessions = new CloudSessionStore({ file: join(directory, 'cloud.json'), keyFile: join(directory, 'key') })
  const local = memoryAccountStore({ clock })
  const fetchFn: typeof fetch = Object.assign(
    async () => Response.json({ user: { email: 'native@example.test' } }),
    { preconnect: () => undefined },
  )
  const service = new CloudService({
    sessions,
    localAccounts: local,
    defaultUrl: ticket.url,
    fetchFn,
    handoffOauth,
  })
  return { service, sessions, local }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('CloudService OAuth activation', () => {
  it('persists the authenticated session before handing off OAuth and waits for completion', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const calls: CloudSession[] = []
    let sessionStore: CloudSessionStore | undefined
    const { service, sessions } = setup(async (session) => {
      expect(sessionStore?.read()).toEqual(session)
      calls.push(session)
      await gate
    })
    sessionStore = sessions
    let complete = false
    const login = service.finishLogin({ ticket, token: 'fake-session' }).then(() => { complete = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(complete).toBe(false)
    release?.()
    await login
    expect(calls).toEqual([{ url: ticket.url, token: 'fake-session', email: 'native@example.test' }])
  })

  it('keeps the confirmed session available when a handoff fails so the pending grant can retry', async () => {
    const { service, sessions } = setup(async () => { throw new Error('handoff unavailable') })
    await expect(service.finishLogin({ ticket, token: 'fake-session' })).rejects.toThrow('handoff unavailable')
    expect(sessions.read()?.token).toBe('fake-session')
  })

  it('does not change API-key accounts when sign-in activates OAuth handoff', async () => {
    const { service, local } = setup(async () => {})
    const account = await local.add({
      provider: EAuthProvider.OpenRouter,
      label: 'API key',
      origin: EAccountOrigin.Login,
      secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' },
    })
    const before = await local.read(account.id)
    await service.finishLogin({ ticket, token: 'fake-session' })
    service.logout()
    expect(await local.read(account.id)).toEqual(before)
  })
})
