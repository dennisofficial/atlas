import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { AccountsService } from '../accounts-service'
import { CredentialError } from '../credential-error'
import { EDevicePoll, type DevicePoll } from '../oauth'
import { movableClock, openVault, type Vault } from './vault-fixture'

let vault: Vault

class ScriptedDeviceClient {
  polls = 0

  constructor(private readonly script: readonly DevicePoll[]) {}

  startDeviceLogin = async () => ({
    deviceAuthId: 'da-1',
    userCode: 'ABCD-EFGH',
    verificationUrl: 'https://auth.openai.com/codex/device',
    intervalMs: 3000,
    expiresInMs: 900_000,
  })

  pollDeviceLogin = async (): Promise<DevicePoll> => {
    const step = this.script[Math.min(this.polls, this.script.length - 1)]
    this.polls += 1
    if (step === undefined) throw new Error('the script ran out')
    return step
  }

  refresh = async () => ({
    accessToken: 'openai-access-2',
    refreshToken: 'openai-refresh-2',
    expiresAt: '2026-01-01T14:00:00.000Z',
  })
}

const DEVICE_LOGIN = {
  tokens: {
    accessToken: 'openai-access',
    refreshToken: 'openai-refresh',
    expiresAt: '2026-01-01T13:00:00.000Z',
    accountId: 'acct-123',
  },
  email: 'dennis@example.com',
  subscription: 'plus',
}

const deviceServiceWith = (script: readonly DevicePoll[]) =>
  new AccountsService({
    accounts: vault.store,
    clients: { [EAuthProvider.OpenAI]: new ScriptedDeviceClient(script) },
  })

beforeEach(() => {
  vault = openVault(movableClock())
})

afterEach(() => {
  vault.close()
})

describe('AccountsService device login', () => {
  it('starts a device login with the code the operator will type into the browser', async () => {
    const ticket = await deviceServiceWith([]).beginDevice(EAuthProvider.OpenAI)

    expect(ticket).toMatchObject({
      provider: EAuthProvider.OpenAI,
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://auth.openai.com/codex/device',
    })
  })

  it('reports a pending poll without leaving an account behind', async () => {
    const service = deviceServiceWith([{ status: EDevicePoll.Pending }])
    const ticket = await service.beginDevice(EAuthProvider.OpenAI)

    expect(await service.pollDevice(ticket)).toEqual({ status: EDevicePoll.Pending })
    expect(await service.list()).toEqual([])
  })

  it('signs in on the poll that completes and makes the account the one that answers', async () => {
    const service = deviceServiceWith([
      { status: EDevicePoll.Pending },
      { status: EDevicePoll.Complete, login: DEVICE_LOGIN },
    ])
    const ticket = await service.beginDevice(EAuthProvider.OpenAI)

    await service.pollDevice(ticket)
    const signIn = await service.pollDevice(ticket)

    expect(signIn.status).toBe(EDevicePoll.Complete)
    if (signIn.status !== EDevicePoll.Complete) return

    expect(signIn.account.label).toBe('dennis@example.com')
    expect(signIn.account.provider).toBe(EAuthProvider.OpenAI)
    expect(await service.activeFor(EAuthProvider.OpenAI)).toBe(signIn.account.id)

    const stored = await vault.store.read(signIn.account.id)
    expect(stored?.secret).toEqual({ kind: EAuthKind.Oauth, tokens: DEVICE_LOGIN.tokens })
  })

  it('refuses a device login for a paste-back provider', async () => {
    expect(deviceServiceWith([]).beginDevice(EAuthProvider.Anthropic)).rejects.toThrow(
      CredentialError,
    )
  })
})
