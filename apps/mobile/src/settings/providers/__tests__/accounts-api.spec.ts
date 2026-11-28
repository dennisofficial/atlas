import { describe, expect, it } from 'bun:test'
import { createApiClient } from '@dltech/atlas-api-router'
import { EProviderId } from '@dltech/atlas-client/settings'
import { createProviderAccountsApi } from '../accounts-api'

const setup = () => {
  const requests: { route: string; input: unknown }[] = []
  const fetchFn: typeof fetch = Object.assign(
    async (target: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(target))
      const route = url.pathname.split('/').at(-1) ?? ''
      const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      const decoded: unknown =
        typeof body === 'object' && body !== null && 'atlasB64' in body
          ? JSON.parse(atob(String(body.atlasB64)))
          : body
      const input: unknown = url.searchParams.has('input')
        ? JSON.parse(url.searchParams.get('input') ?? 'null')
        : decoded
      requests.push({ route, input })
      return Response.json({
        result: {
          data:
            route === 'accounts.list'
              ? []
              : route === 'accounts.active'
                ? { accountId: 'active' }
                : {},
        },
      })
    },
    { preconnect: () => undefined },
  )
  return {
    requests,
    accounts: createProviderAccountsApi(
      createApiClient({ baseUrl: 'https://api.example', fetchFn }),
    ),
  }
}

describe('mobile provider account API', () => {
  it('loads accounts and every provider active selection', async () => {
    const { requests, accounts } = setup()
    expect(await accounts.load()).toEqual({
      accounts: [],
      active: Object.fromEntries(
        Object.values(EProviderId).map((provider) => [provider, 'active']),
      ),
    })
    expect(requests.filter((request) => request.route === 'accounts.active')).toHaveLength(6)
  })
  it('creates an API key with the label and activation choice', async () => {
    const { requests, accounts } = setup()
    await accounts.add({ provider: EProviderId.Gateway, key: 'secret', name: 'Work', use: true })
    expect(requests[0]).toEqual({
      route: 'accounts.create',
      input: {
        provider: 'gateway',
        label: 'Work',
        origin: 'login',
        secret: { kind: 'api-key', apiKey: 'secret' },
        makeActive: true,
      },
    })
  })
  it('uses the same replace, rename, activate and remove calls as web', async () => {
    const { requests, accounts } = setup()
    await accounts.replace({ accountId: 'one', key: 'replacement' })
    await accounts.rename({ accountId: 'one', name: 'Renamed' })
    await accounts.activate({ provider: EProviderId.Anthropic, accountId: 'one' })
    await accounts.remove('one')
    expect(requests).toEqual([
      {
        route: 'accounts.replaceSecret',
        input: { accountId: 'one', secret: { kind: 'api-key', apiKey: 'replacement' } },
      },
      { route: 'accounts.rename', input: { accountId: 'one', label: 'Renamed' } },
      { route: 'accounts.setActive', input: { provider: 'anthropic', accountId: 'one' } },
      { route: 'accounts.remove', input: { accountId: 'one' } },
    ])
  })
})
