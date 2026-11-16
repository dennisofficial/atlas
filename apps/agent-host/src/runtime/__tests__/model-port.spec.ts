import { describe, expect, it } from 'bun:test'
import { EEffort } from '@dltech/atlas-core'

import { cipher, sealed } from '../../config/__tests__/config-reader.fixture'
import { modelSourceOf, type AccountRow, type SessionModelRow } from '../../config/model-config'
import { liveSessionModelsOf } from '../model-port'

const NOW = new Date('2026-11-05T12:00:00.000Z')

const accountRow = (args: { id: string; provider: string }): AccountRow => ({
  id: args.id,
  provider: args.provider,
  kind: 'api-key',
  origin: 'login',
  label: args.id,
  status: 'active',
  email: null,
  subscription: null,
  importedFrom: null,
  sealedSecret: sealed({ kind: 'api-key', apiKey: `key-${args.id}` }),
  createdAt: NOW,
  updatedAt: NOW,
})

const setting = (value: unknown): string => `atlas-setting:v1:${JSON.stringify(value)}`

const HAIKU: SessionModelRow = { ref: 'anthropic/claude-haiku-4-5', effort: 'medium', fast: false }

const sourceOf = (args: { settings: Record<string, unknown>; session?: SessionModelRow }) =>
  modelSourceOf({
    cipher,
    accounts: [
      accountRow({ id: 'a', provider: 'anthropic' }),
      accountRow({ id: 'o', provider: 'openai' }),
    ],
    activeAccounts: [],
    settings: new Map(Object.entries(args.settings).map(([key, value]) => [key, setting(value)])),
    session: args.session ?? HAIKU,
  })

const tokens = {
  issue: async (): Promise<never> => {
    throw new Error('unused')
  },
}

const modelsOver = (args: { settings: Record<string, unknown>; session?: SessionModelRow }) =>
  liveSessionModelsOf({
    userId: 'user-1',
    initial: sourceOf(args),
    read: async () => sourceOf(args),
    tokens,
  })

describe('liveSessionModelsOf', () => {
  it('builds a role’s port on the choice its spawner fixed, not on Main', () => {
    const models = modelsOver({
      settings: {},
      session: { ref: 'anthropic/claude-sonnet-4-5', effort: 'high', fast: false },
    })
    expect(models.main.identity).toEqual({ id: 'anthropic', modelId: 'claude-sonnet-4-5' })
    const pinned = models.modelOf({
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      fast: false,
    })
    expect(pinned.identity).toEqual({ id: 'openai', modelId: 'gpt-5' })
  })

  it('hands out a fresh port per pinned choice', () => {
    const models = modelsOver({ settings: {} })
    const choice = {
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      fast: false,
    }
    expect(models.modelOf(choice)).not.toBe(models.modelOf(choice))
  })
})
