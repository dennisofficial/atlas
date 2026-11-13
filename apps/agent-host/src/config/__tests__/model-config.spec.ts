import { describe, expect, it } from 'bun:test'
import { EEffort } from '@dltech/atlas-core'
import { cardsForProvider } from '@dltech/atlas-models'

import { modelConfigOf, modelSourceOf, type AccountRow } from '../model-config'
import { cipher, sealed } from './config-reader.fixture'

const NOW = new Date('2026-11-05T12:00:00.000Z')

const accountRow = (args: { id: string; provider: string; secret?: unknown }): AccountRow => ({
  id: args.id,
  provider: args.provider,
  kind: 'api-key',
  origin: 'login',
  label: args.id,
  status: 'active',
  email: null,
  subscription: null,
  importedFrom: null,
  sealedSecret: sealed(args.secret ?? { kind: 'api-key', apiKey: `key-${args.id}` }),
  createdAt: NOW,
  updatedAt: NOW,
})

const setting = (value: unknown): string => `atlas-setting:v1:${JSON.stringify(value)}`

const configOf = (args: {
  accounts: AccountRow[]
  settings?: Record<string, unknown>
  active?: { provider: string; accountId: string }[]
}) =>
  modelConfigOf({
    cipher,
    accounts: args.accounts,
    activeAccounts: args.active ?? [],
    settings: new Map(Object.entries(args.settings ?? {}).map(([k, v]) => [k, setting(v)])),
  })

describe('modelConfigOf', () => {
  it('selects the openai account for an openai model', () => {
    const config = configOf({
      accounts: [
        accountRow({ id: 'a', provider: 'anthropic' }),
        accountRow({ id: 'o', provider: 'openai' }),
      ],
      settings: { 'model.id': 'openai/gpt-5' },
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
      settings: { 'model.id': 'openrouter/anthropic/claude-sonnet-4.5' },
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
      settings: { 'model.id': 'openai/gpt-5' },
      active: [{ provider: 'openai', accountId: 'o1' }],
    })
    expect(config).toMatchObject({ accountId: 'o1' })
  })

  it('reports a gap instead of substituting when the model provider has no account', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { 'model.id': 'openai/gpt-5' },
    })
    expect(config).toEqual({ configured: false, gap: 'no openai account' })
  })

  it('reports a gap for an unknown provider prefix', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { 'model.id': 'mystery/model' },
    })
    expect(config).toEqual({ configured: false, gap: 'no mystery account' })
  })

  it('defaults to haiku when an anthropic account exists and the model is unset', () => {
    const config = configOf({
      accounts: [
        accountRow({ id: 'o', provider: 'openai' }),
        accountRow({ id: 'a', provider: 'anthropic' }),
      ],
    })
    expect(config).toMatchObject({ ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' } })
  })

  it('defaults to the first openai card when only an openai account exists', () => {
    const config = configOf({ accounts: [accountRow({ id: 'o', provider: 'openai' })] })
    const first = cardsForProvider('openai')[0]
    expect(first).toBeDefined()
    expect(config).toMatchObject({ configured: true, ref: first?.ref, accountId: 'o' })
  })

  it('treats an unparseable model id as unset', () => {
    const config = configOf({
      accounts: [accountRow({ id: 'o', provider: 'openai' })],
      settings: { 'model.id': 'gpt-5' },
    })
    expect(config).toMatchObject({ configured: true, ref: cardsForProvider('openai')[0]?.ref })
  })

  it('reports no model account when nothing is connected', () => {
    expect(configOf({ accounts: [] })).toEqual({ configured: false, gap: 'no model account' })
  })

  it('clamps effort to the model’s rungs and keeps fast only where the model offers it', () => {
    const accounts = [accountRow({ id: 'a', provider: 'anthropic' })]
    expect(
      configOf({ accounts, settings: { 'model.effort': 'xhigh', 'model.fast': true } }),
    ).toMatchObject({ effort: EEffort.High, fast: false })
    expect(
      configOf({ accounts, settings: { 'model.effort': 'low', 'model.fast': true } }),
    ).toMatchObject({ effort: EEffort.Low, fast: false })
    expect(
      configOf({ accounts, settings: { 'model.effort': 'bogus', 'model.fast': 'yes' } }),
    ).toMatchObject({ effort: EEffort.Medium, fast: false })
    expect(configOf({ accounts })).toMatchObject({ effort: EEffort.Medium, fast: false })
    expect(
      configOf({
        accounts,
        settings: { 'model.id': 'anthropic/claude-opus-5', 'model.fast': true },
      }),
    ).toMatchObject({ ref: { modelId: 'claude-opus-5' }, fast: true })
  })

  it('runs a model the catalogue does not list yet instead of refusing it', () => {
    const accounts = [accountRow({ id: 'a', provider: 'anthropic' })]
    expect(
      configOf({
        accounts,
        settings: { 'model.id': 'anthropic/claude-next', 'model.effort': 'high' },
      }),
    ).toMatchObject({
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
    const withConnection = configOf({
      accounts: [
        accountRow({
          id: 'o',
          provider: 'openai',
          secret: oauth({ url: 'https://cloud.test', connectionId: 'conn-9' }),
        }),
      ],
      settings: { 'model.id': 'openai/gpt-5' },
    })
    expect(withConnection).toMatchObject({ credential: { kind: 'oauth', connectionId: 'conn-9' } })
    const without = configOf({
      accounts: [accountRow({ id: 'o', provider: 'openai', secret: oauth() })],
      settings: { 'model.id': 'openai/gpt-5' },
    })
    expect(without).toEqual({ configured: false, gap: 'oauth account has no cloud connection' })
  })
})

const sourceOf = (args: {
  accounts: AccountRow[]
  settings?: Record<string, unknown>
  thread?: { ref: string; effort?: string; fast?: boolean }
}) =>
  modelSourceOf({
    cipher,
    accounts: args.accounts,
    activeAccounts: [],
    settings: new Map(Object.entries(args.settings ?? {}).map(([k, v]) => [k, setting(v)])),
    ...(args.thread === undefined ? {} : { thread: args.thread }),
  })

const OPENAI_AND_ANTHROPIC = [
  accountRow({ id: 'a', provider: 'anthropic' }),
  accountRow({ id: 'o', provider: 'openai' }),
]

describe('modelSourceOf', () => {
  it('runs Main on the model the thread chose over the settings', () => {
    const source = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: { 'model.id': 'anthropic/claude-sonnet-4-5', 'model.effort': 'high' },
      thread: { ref: 'openai/gpt-5', effort: 'low' },
    })
    expect(source.main.choice).toMatchObject({
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      stale: false,
    })
    expect(source.main.config).toMatchObject({ configured: true, accountId: 'o' })
  })

  it('runs Main on the settings model when no thread chose one', () => {
    const source = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: { 'model.id': 'openai/gpt-5' },
    })
    expect(source.main.config).toMatchObject({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      accountId: 'o',
      effort: EEffort.Medium,
    })
  })

  it('gives a sub-agent type its own model, account and effort', () => {
    const source = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: {
        'agents.type.builder': 'openai/gpt-5',
        'agents.type.builder.effort': 'low',
      },
    })
    const resolved = source.resolve({ role: { agentType: 'builder' } })
    expect(resolved.config).toMatchObject({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      accountId: 'o',
      effort: EEffort.Low,
    })
    expect(resolved.choice.follows).toBeUndefined()
  })

  it('makes a follower use the spawner’s choice, effort and account', () => {
    const root = {
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.High,
      fast: false,
    }
    const source = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: { 'agents.type.builder.effort': 'low' },
    })
    const resolved = source.resolve({ role: { agentType: 'builder' }, root })
    expect(resolved.choice).toMatchObject({
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.High,
      follows: 'subagents',
    })
    expect(resolved.config).toMatchObject({ configured: true, accountId: 'o' })
  })

  it('follows Main, not Subagents, for the teammate type', () => {
    const source = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: {
        'agents.subagentModel': 'openai/gpt-5',
        'agents.type.teammate': 'anthropic/claude-sonnet-4-5',
      },
    })
    const resolved = source.resolve({ role: { agentType: 'teammate' } })
    expect(resolved.config).toMatchObject({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      accountId: 'a',
    })
  })

  it('lets a role with an unreachable own model follow its parent instead of swapping', () => {
    const source = sourceOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { 'agents.type.builder': 'openai/gpt-5' },
    })
    const resolved = source.resolve({ role: { agentType: 'builder' } })
    expect(resolved.choice).toMatchObject({
      ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      follows: 'subagents',
      stale: true,
    })
    expect(resolved.config).toMatchObject({ configured: true, accountId: 'a' })
  })
})
