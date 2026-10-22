import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EAuthKind,
  EAuthProvider,
  EAccountOrigin,
  toThreadId,
  type AccountStorePort,
  type ClockPort,
} from '@dltech/atlas-core'

import { memoryAccountStore } from '../../credentials/account-store'
import { CloudService } from '../cloud-service'
import { CloudSessionStore, type CloudSession } from '../cloud-session'
import type { CloudLoginTicket } from '../device-login'

const directories: string[] = []
const realAtlasHome = process.env['ATLAS_HOME']
const clock: ClockPort = { now: () => '2026-10-05T12:00:00.000Z' }
const ticket: CloudLoginTicket = {
  url: 'https://cloud.test',
  deviceCode: 'fake-device',
  userCode: 'fake-code',
  verificationUrl: 'https://cloud.test/device',
  expiresInMs: 60_000,
  intervalMs: 1_000,
}

const setup = (
  handoffOauth: (session: CloudSession) => Promise<void>,
  accounts?: AccountStorePort,
) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-oauth-signin-'))
  directories.push(directory)
  process.env['ATLAS_HOME'] = directory
  const sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  const local = memoryAccountStore({ clock })
  const fetchFn: typeof fetch = Object.assign(
    async () => Response.json({ user: { email: 'native@example.test' } }),
    { preconnect: () => undefined },
  )
  const service = new CloudService({
    sessions,
    localAccounts: local,
    ...(accounts === undefined ? {} : { accounts }),
    defaultUrl: ticket.url,
    fetchFn,
    handoffOauth,
  })
  return { service, sessions, local }
}

afterEach(() => {
  if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = realAtlasHome
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const birth = {
  threadId: toThreadId('oauth-root'),
  token: 'fake-sandbox',
  serveUrl: 'https://sandbox.vercel.run',
}

const addNativeOauth = (accounts: AccountStorePort) =>
  accounts.add({
    provider: EAuthProvider.Anthropic,
    origin: EAccountOrigin.Login,
    label: 'native',
    secret: {
      kind: EAuthKind.Oauth,
      tokens: {
        accessToken: 'fake-access',
        refreshToken: '',
        expiresAt: '2026-10-05T13:00:00.000Z',
      },
      authority: { url: ticket.url, connectionId: 'oauth-native' },
    },
  })

describe('CloudService prepareSandboxOauth account store', () => {
  it('authorizes against the injected account store, not the local one', async () => {
    const injected = memoryAccountStore({ clock })
    const { service, local } = setup(async () => {}, injected)
    await addNativeOauth(local)

    await service.prepareSandboxOauth(birth)
  })

  it('sees an OAuth account held only by the injected store', async () => {
    const injected = memoryAccountStore({ clock })
    const { service } = setup(async () => {}, injected)
    await addNativeOauth(injected)

    await expect(service.prepareSandboxOauth(birth)).rejects.toThrow('Sign in to Atlas Cloud')
  })

  it('falls back to the local store when none is injected', async () => {
    const { service, local } = setup(async () => {})
    await addNativeOauth(local)

    await expect(service.prepareSandboxOauth(birth)).rejects.toThrow('Sign in to Atlas Cloud')
  })
})

describe('CloudService OAuth activation', () => {
  it('persists the authenticated session before handing off OAuth and waits for completion', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: CloudSession[] = []
    let sessionStore: CloudSessionStore | undefined
    const { service, sessions } = setup(async (session) => {
      expect(sessionStore?.read()).toEqual(session)
      calls.push(session)
      await gate
    })
    sessionStore = sessions
    let complete = false
    const login = service.finishLogin({ ticket, token: 'fake-session' }).then(() => {
      complete = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(complete).toBe(false)
    release?.()
    await login
    expect(calls).toEqual([
      { url: ticket.url, token: 'fake-session', email: 'native@example.test' },
    ])
  })

  it('keeps the confirmed session available when a handoff fails so the pending grant can retry', async () => {
    const { service, sessions } = setup(async () => {
      throw new Error('handoff unavailable')
    })
    await expect(service.finishLogin({ ticket, token: 'fake-session' })).rejects.toThrow(
      'handoff unavailable',
    )
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
