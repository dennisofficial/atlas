import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { AccountsService } from '../accounts-service'
import { CredentialError } from '../credential-error'
import { type BrowserLoginSession, type OauthLogin } from '../oauth'
import { movableClock, openVault, type Vault } from './vault-fixture'

const BROWSER_LOGIN = {
  tokens: {
    accessToken: 'openai-access',
    refreshToken: 'openai-refresh',
    expiresAt: '2026-01-01T13:00:00.000Z',
    accountId: 'acct-123',
  },
  email: 'dennis@example.com',
  subscription: 'plus',
}

let vault: Vault

class ScriptedBrowserClient {
  cancelled = 0
  private settle: { resolve: (login: OauthLogin) => void; reject: (reason: Error) => void } | undefined

  startBrowserLogin = async (): Promise<BrowserLoginSession> => ({
    url: 'https://auth.openai.com/oauth/authorize?state=s',
    login: new Promise<OauthLogin>((resolve, reject) => {
      this.settle = { resolve, reject }
    }),
    cancel: async () => {
      this.cancelled += 1
      this.settle?.reject(new Error('sign-in cancelled'))
    },
  })

  succeed(login: OauthLogin): void {
    this.settle?.resolve(login)
  }

  fail(reason: Error): void {
    this.settle?.reject(reason)
  }

  refresh = async () => ({
    accessToken: 'openai-access-2',
    refreshToken: 'openai-refresh-2',
    expiresAt: '2026-01-01T14:00:00.000Z',
  })
}

const browserServiceWith = (client: ScriptedBrowserClient) =>
  new AccountsService({
    accounts: vault.store,
    clients: { [EAuthProvider.OpenAI]: client },
  })

beforeEach(() => {
  vault = openVault(movableClock())
})

afterEach(() => {
  vault.close()
})

describe('AccountsService browser login', () => {
  it('hands the operator the browser url and stores the account once the browser login lands', async () => {
    const client = new ScriptedBrowserClient()
    const service = browserServiceWith(client)

    const ticket = await service.beginBrowser(EAuthProvider.OpenAI)
    expect(ticket.provider).toBe(EAuthProvider.OpenAI)
    expect(ticket.url).toBe('https://auth.openai.com/oauth/authorize?state=s')
    expect(await service.list()).toEqual([])

    client.succeed(BROWSER_LOGIN)
    const account = await ticket.login

    expect(account.label).toBe('dennis@example.com')
    expect(account.provider).toBe(EAuthProvider.OpenAI)
    expect(await service.activeFor(EAuthProvider.OpenAI)).toBe(account.id)
    expect((await vault.store.read(account.id))?.secret).toEqual({
      kind: EAuthKind.Oauth,
      tokens: BROWSER_LOGIN.tokens,
    })
  })

  it('leaves no account behind when the browser login fails', async () => {
    const client = new ScriptedBrowserClient()
    const service = browserServiceWith(client)
    const ticket = await service.beginBrowser(EAuthProvider.OpenAI)

    client.fail(new Error('the authorization server refused the sign-in: access_denied'))
    const failure = await ticket.login.catch((error: unknown) => error)

    expect((failure as Error).message).toContain('access_denied')
    expect(await service.list()).toEqual([])
  })

  it('leaves no account behind when the browser login is cancelled', async () => {
    const client = new ScriptedBrowserClient()
    const service = browserServiceWith(client)
    const ticket = await service.beginBrowser(EAuthProvider.OpenAI)

    await ticket.cancel()
    const failure = await ticket.login.catch((error: unknown) => error)

    expect((failure as Error).message).toBe('sign-in cancelled')
    expect(client.cancelled).toBe(1)
    expect(await service.list()).toEqual([])
    expect(await service.activeFor(EAuthProvider.OpenAI)).toBeUndefined()
  })

  it('refuses a browser login for a provider without that flow, or a client that cannot do it', async () => {
    const anthropic = browserServiceWith(new ScriptedBrowserClient()).beginBrowser(
      EAuthProvider.Anthropic,
    )
    expect(anthropic).rejects.toThrow(CredentialError)

    const noFlow = new AccountsService({
      accounts: vault.store,
      clients: { [EAuthProvider.OpenAI]: { refresh: async () => ({ accessToken: '', refreshToken: '', expiresAt: '' }) } },
    })
    expect(noFlow.beginBrowser(EAuthProvider.OpenAI)).rejects.toThrow(CredentialError)
  })
})
