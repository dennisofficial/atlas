import { describe, expect, it } from 'bun:test'
import { EEffort } from '@dltech/atlas-core'
import { cardsForProvider } from '@dltech/atlas-models'

import { modelConfigOf, type AccountRow, type SessionModelRow } from '../model-config'
import { cipher } from './config-reader.fixture'
import { accountRow, HAIKU, NOW, setting } from './model-config.fixture'

const configOf = (args: {
  accounts: AccountRow[]
  session?: SessionModelRow
  settings?: Record<string, unknown>
  active?: { provider: string; accountId: string }[]
}) =>
  modelConfigOf({
    cipher,
    accounts: args.accounts,
    activeAccounts: args.active ?? [],
    settings: new Map(Object.entries(args.settings ?? {}).map(([k, v]) => [k, setting(v)])),
    session: args.session ?? HAIKU,
  })

describe('modelConfigOf', () => {
  it('selects the openai account for an openai model', () => {
    const config = configOf({
      accounts: [
        accountRow({ id: 'a', provider: 'anthropic' }),
        accountRow({ id: 'o', provider: 'openai' }),
      ],
      session: { ref: 'openai/gpt-5', effort: 'medium', fast: false },
    })
    expect(config).toMatchObject({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      accountId: 'o',
      credential: { kind: 'api-key', apiKey: 'key-o' },
    })
  })

  it('selects the openrouter account and keeps slashes in the model id', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'r', provider: 'openrouter' })],
      session: { ref: 'openrouter/anthropic/claude-sonnet-4.5', effort: 'medium', fast: false },
    })
    expect(config).toMatchObject({
      configured: true,
      ref: { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet-4.5' },
      accountId: 'r',
    })
  })

  it('prefers the active account of the model provider', () => {
    const config = configOf({
      accounts: [
        accountRow({ id: 'o1', provider: 'openai' }),
        accountRow({ id: 'o2', provider: 'openai' }),
      ],
      session: { ref: 'openai/gpt-5', effort: 'medium', fast: false },
      active: [{ provider: 'openai', accountId: 'o1' }],
    })
    expect(config).toMatchObject({ accountId: 'o1' })
  })

  it('reports a gap instead of substituting when the model provider has no account', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      session: { ref: 'openai/gpt-5', effort: 'medium', fast: false },
    })
    expect(config).toEqual({
      configured: false,
      gap: 'no openai account',
      unavailable: { providerId: 'openai', modelId: 'gpt-5' },
    })
  })

  it('reports a gap for an unknown provider prefix', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      session: { ref: 'mystery/model', effort: 'medium', fast: false },
    })
    expect(config).toEqual({
      configured: false,
      gap: 'no mystery account',
      unavailable: { providerId: 'mystery', modelId: 'model' },
    })
  })

  it('falls back to the reachable default when the session ref does not parse', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'o', provider: 'openai' })],
      session: { ref: 'gpt-5', effort: 'medium', fast: false },
    })
    expect(config).toMatchObject({
      configured: true,
      ref: cardsForProvider('openai')[0]?.ref,
      accountId: 'o',
    })
  })

  it('reports no model account when nothing is connected', () => {
    expect(configOf({ accounts: [] })).toEqual({ configured: false, gap: 'no model account' })
  })

  it('clamps the session effort to the model’s rungs and keeps fast only where it is offered', () => {
    const accounts = [accountRow({ id: 'a', provider: 'anthropic' })]
    expect(
      configOf({
        accounts,
        session: { ref: 'anthropic/claude-haiku-4-5', effort: 'xhigh', fast: true },
      }),
    ).toMatchObject({ effort: EEffort.High, fast: false })
    expect(
      configOf({
        accounts,
        session: { ref: 'anthropic/claude-haiku-4-5', effort: 'bogus', fast: false },
      }),
    ).toMatchObject({ effort: EEffort.Medium, fast: false })
    expect(
      configOf({
        accounts,
        session: { ref: 'anthropic/claude-opus-5', effort: 'low', fast: true },
      }),
    ).toMatchObject({ ref: { modelId: 'claude-opus-5' }, fast: true })
  })

  it('runs a model the catalogue does not list yet instead of refusing it', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      session: { ref: 'anthropic/claude-next', effort: 'high', fast: false },
    })
    expect(config).toMatchObject({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-next' },
      effort: EEffort.High,
      fast: false,
    })
  })

  it('returns an oauth credential for any provider and a gap without a connection', () => {
    const oauth = (authority?: unknown) => ({
      kind: 'oauth',
      tokens: { accessToken: 'x', refreshToken: 'y', expiresAt: NOW.toISOString() },
      ...(authority === undefined ? {} : { authority }),
    })
    const session: SessionModelRow = { ref: 'openai/gpt-5', effort: 'medium', fast: false }
    const withConnection = configOf({
      accounts: [
        accountRow({
          id: 'o',
          provider: 'openai',
          secret: oauth({ url: 'https://cloud.test', connectionId: 'conn-9' }),
        }),
      ],
      session,
    })
    expect(withConnection).toMatchObject({ credential: { kind: 'oauth', connectionId: 'conn-9' } })
    const without = configOf({
      accounts: [accountRow({ id: 'o', provider: 'openai', secret: oauth() })],
      session,
    })
    expect(without).toEqual({ configured: false, gap: 'oauth account has no cloud connection' })
  })
})
