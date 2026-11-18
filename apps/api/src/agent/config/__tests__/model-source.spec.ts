import { describe, expect, it } from 'bun:test'
import { EEffort } from '@dltech/atlas-core'

import { modelSourceOf, type AccountRow, type SessionModelRow } from '../model-config'
import { cipher } from './config-reader.fixture'
import { accountRow, HAIKU, setting } from './model-config.fixture'

const sourceOf = (args: {
  accounts: AccountRow[]
  session?: SessionModelRow
  settings?: Record<string, unknown>
  active?: { provider: string; accountId: string }[]
}) =>
  modelSourceOf({
    cipher,
    accounts: args.accounts,
    activeAccounts: args.active ?? [],
    settings: new Map(Object.entries(args.settings ?? {}).map(([k, v]) => [k, setting(v)])),
    session: args.session ?? HAIKU,
  })

const OPENAI_AND_ANTHROPIC = [
  accountRow({ id: 'a', provider: 'anthropic' }),
  accountRow({ id: 'o', provider: 'openai' }),
]

describe('modelSourceOf', () => {
  it('ignores the Main settings for a session', () => {
    const source = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: { 'model.id': 'anthropic/claude-sonnet-4-5', 'model.effort': 'high' },
      session: { ref: 'openai/gpt-5', effort: 'low', fast: false },
    })
    expect(source.main.choice).toMatchObject({
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      stale: false,
    })
    expect(source.main.config).toMatchObject({ configured: true, accountId: 'o' })
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

  it('lets a role with an unreachable own model follow Main and reports it unavailable', () => {
    const source = sourceOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { 'agents.type.builder': 'openai/gpt-5' },
    })
    const resolved = source.resolve({ role: { agentType: 'builder' } })
    expect(resolved.choice).toMatchObject({
      ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      follows: 'main',
      stale: true,
      unavailable: { providerId: 'openai', modelId: 'gpt-5' },
    })
    expect(resolved.config).toMatchObject({ configured: true, accountId: 'a' })
  })

  it('keeps a session model whose provider has no account and reports it unavailable', () => {
    const source = sourceOf({
      accounts: [accountRow({ id: 'a', provider: 'anthropic' })],
      settings: { 'model.id': 'anthropic/claude-sonnet-4-5' },
      session: { ref: 'openai/gpt-5', effort: 'low', fast: false },
    })
    expect(source.main.choice).toMatchObject({
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      stale: false,
    })
    expect(source.main.config).toEqual({
      configured: false,
      gap: 'no openai account',
      unavailable: { providerId: 'openai', modelId: 'gpt-5' },
    })
  })

  it('pins a spawned choice over the Main the settings later name', () => {
    const choice = {
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      fast: false,
    }
    const later = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      settings: { 'model.id': 'anthropic/claude-sonnet-4-5', 'model.effort': 'high' },
    })
    expect(later.pinned(choice)).toMatchObject({
      choice: { ref: { providerId: 'openai', modelId: 'gpt-5' }, effort: EEffort.Low, fast: false },
      config: { configured: true, accountId: 'o', effort: EEffort.Low, fast: false },
    })
  })

  it('reads the account of a pinned choice from the accounts active now', () => {
    const choice = {
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      fast: false,
    }
    const before = sourceOf({
      accounts: OPENAI_AND_ANTHROPIC,
      active: [{ provider: 'openai', accountId: 'o' }],
    })
    const moved = sourceOf({
      accounts: [accountRow({ id: 'o2', provider: 'openai' })],
      active: [{ provider: 'openai', accountId: 'o2' }],
    })
    expect(before.pinned(choice).config).toMatchObject({ configured: true, accountId: 'o' })
    expect(moved.pinned(choice).config).toMatchObject({ configured: true, accountId: 'o2' })
  })
})
