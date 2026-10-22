import { describe, expect, it } from 'bun:test'
import {
  CredentialPort,
  EAuthKind,
  EAuthProvider,
  EUsageWindow,
  toAccountId,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-core'

import { CODEX_USAGE_URL, CodexUsageClient } from '../codex-usage-client'

const ACCOUNT = toAccountId('account-1')

const OAUTH: Credential = {
  kind: EAuthKind.Oauth,
  accountId: ACCOUNT,
  accessToken: 'access-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  providerAccountId: 'chatgpt-account-9',
}

class StubCredentials extends CredentialPort {
  readonly requests: (CredentialRequest | undefined)[] = []

  constructor(private readonly answer: () => Promise<Credential>) {
    super()
  }

  read(request?: CredentialRequest): Promise<Credential> {
    this.requests.push(request)
    return this.answer()
  }

  async discard(): Promise<void> {}
}

const respondingWith = (body: unknown, status = 200): typeof globalThis.fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch

const clientOf = (args: {
  fetch: typeof globalThis.fetch
  credential?: () => Promise<Credential>
}): { client: CodexUsageClient; credentials: StubCredentials } => {
  const credentials = new StubCredentials(args.credential ?? (async () => OAUTH))
  return { client: new CodexUsageClient({ credentials, fetch: args.fetch }), credentials }
}

describe('CodexUsageClient', () => {
  it('reads both windows for an account', async () => {
    const { client } = clientOf({
      fetch: respondingWith({
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 34, reset_at: 1_788_000_000 },
          secondary_window: { used_percent: 61, reset_at: 1_788_500_000 },
        },
      }),
    })

    const usage = await client.read({ accountId: ACCOUNT })

    expect(usage?.[EUsageWindow.FiveHour]?.utilization).toBe(34)
    expect(usage?.[EUsageWindow.SevenDay]?.utilization).toBe(61)
  })

  it('scopes the credential read to the OpenAI provider and the requested account', async () => {
    const { client, credentials } = clientOf({ fetch: respondingWith({}) })

    await client.read({ accountId: ACCOUNT })

    expect(credentials.requests).toEqual([{ provider: EAuthProvider.OpenAI, accountId: ACCOUNT }])
  })

  it('still scopes to the OpenAI provider when no account is named', async () => {
    const { client, credentials } = clientOf({ fetch: respondingWith({}) })

    await client.read({})

    expect(credentials.requests[0]?.provider).toBe(EAuthProvider.OpenAI)
    expect(credentials.requests[0]?.accountId).toBeUndefined()
  })

  it('presents the bearer token, the chatgpt account id, and the codex user-agent', async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {}
    const { client } = clientOf({
      fetch: (async (url: string, init: RequestInit) => {
        seen.url = url
        seen.headers = init.headers as Record<string, string>
        return new Response('{}', { status: 200 })
      }) as unknown as typeof globalThis.fetch,
    })

    await client.read({ accountId: ACCOUNT })

    expect(seen.url).toBe(CODEX_USAGE_URL)
    expect(seen.headers?.Authorization).toBe('Bearer access-token')
    expect(seen.headers?.['ChatGPT-Account-ID']).toBe('chatgpt-account-9')
    expect(seen.headers?.['user-agent']).toStartWith('codex-cli/')
  })

  it('omits the chatgpt account id when the credential carries none', async () => {
    const seen: { headers?: Record<string, string> } = {}
    const { client } = clientOf({
      fetch: (async (_url: string, init: RequestInit) => {
        seen.headers = init.headers as Record<string, string>
        return new Response('{}', { status: 200 })
      }) as unknown as typeof globalThis.fetch,
      credential: async () => ({ ...OAUTH, providerAccountId: undefined }),
    })

    await client.read({ accountId: ACCOUNT })

    expect(seen.headers).toBeDefined()
    expect('ChatGPT-Account-ID' in (seen.headers ?? {})).toBe(false)
  })

  it('has nothing to report for an api key, and never calls the endpoint', async () => {
    let calls = 0
    const { client } = clientOf({
      fetch: (async () => {
        calls += 1
        return new Response('{}', { status: 200 })
      }) as unknown as typeof globalThis.fetch,
      credential: async () => ({ kind: EAuthKind.ApiKey, accountId: ACCOUNT, apiKey: 'sk-x' }),
    })

    expect(await client.read({ accountId: ACCOUNT })).toBeNull()
    expect(calls).toBe(0)
  })

  it('goes quiet rather than failing when the endpoint refuses', async () => {
    const { client } = clientOf({ fetch: respondingWith({ error: 'nope' }, 401) })
    expect(await client.read({ accountId: ACCOUNT })).toBeNull()
  })

  it('goes quiet rather than failing when the request never lands', async () => {
    const { client } = clientOf({
      fetch: (async () => {
        throw new Error('socket hang up')
      }) as unknown as typeof globalThis.fetch,
    })
    expect(await client.read({ accountId: ACCOUNT })).toBeNull()
  })

  it('goes quiet rather than failing when the body is not json', async () => {
    const { client } = clientOf({
      fetch: (async () =>
        new Response('<html>', { status: 200 })) as unknown as typeof globalThis.fetch,
    })
    expect(await client.read({ accountId: ACCOUNT })).toBeNull()
  })

  it('goes quiet rather than failing when there is no account to ask about', async () => {
    const { client } = clientOf({
      fetch: respondingWith({}),
      credential: async () => {
        throw new Error('no account')
      },
    })
    expect(await client.read({ accountId: ACCOUNT })).toBeNull()
  })
})
