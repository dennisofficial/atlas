import { describe, expect, it } from 'bun:test'

import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  EImageTier,
  type Account,
  type AccountId,
  type ModelCard,
} from '@dltech/atlas-core'

import {
  catalogueLabel,
  catalogueProviders,
  isRefReachable,
  knownRefs,
  composeModelCatalogue,
  unanswerableRef,
  unmeasuredWindowWarning,
  type LiveCards,
} from '../catalogue-composition'

const account = (kind: EAuthKind): Account => ({
  id: `acc_${kind}` as AccountId,
  provider: EAuthProvider.OpenAI,
  kind,
  origin: EAccountOrigin.Login,
  label: 'openai',
  status: EAccountStatus.Active,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const LIVE_CARD: ModelCard = {
  ref: { providerId: 'openai', modelId: 'gpt-live-only' },
  label: 'Live Only',
  api: 'openai-responses',
  contextWindow: 123_000,
  imageTier: EImageTier.Standard,
}

const liveOf = (cards: readonly ModelCard[] | undefined): LiveCards => ({
  cards: (providerId) => (providerId === 'openai' ? cards : undefined),
  subscribe: () => () => {},
  refresh: async () => {},
})

describe('catalogueProviders', () => {
  it('lists the four providers with the labels the pickers show', () => {
    expect(catalogueProviders().map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'anthropic', label: 'Claude Plan' },
      { id: 'openai', label: 'Codex Plan' },
      { id: 'openrouter', label: 'OpenRouter' },
      { id: 'inference', label: 'Inference.net' },
    ])
  })

  it('carries the generated cards for each provider', () => {
    for (const provider of catalogueProviders()) {
      expect(provider.cards().length).toBeGreaterThan(0)
      expect(provider.cards().every((card) => card.ref.providerId === provider.id)).toBe(true)
    }
  })
})

describe('modelCatalogue', () => {
  const catalogueWith = (args: { kind: EAuthKind; live: LiveCards }) =>
    composeModelCatalogue({
      providers: catalogueProviders(),
      accounts: [account(args.kind)],
      live: args.live,
    })

  const openAiCards = (catalogue: ReturnType<typeof catalogueWith>) =>
    catalogue.providers.find((provider) => provider.id === 'openai')?.cards ?? []

  it('replaces the static list with the live one for a ChatGPT login', () => {
    const catalogue = catalogueWith({ kind: EAuthKind.Oauth, live: liveOf([LIVE_CARD]) })

    expect(openAiCards(catalogue)).toEqual([LIVE_CARD])
    expect(catalogue.cardFor(LIVE_CARD.ref)).toEqual(LIVE_CARD)
  })

  it('keeps the static list for an API key', () => {
    const catalogue = catalogueWith({ kind: EAuthKind.ApiKey, live: liveOf([LIVE_CARD]) })

    expect(openAiCards(catalogue)).not.toContainEqual(LIVE_CARD)
    expect(catalogue.subscribed('openai')).toBe(false)
    expect(catalogue.reachable('openai')).toBe(true)
  })

  it('answers the lookups over the composed catalogue', () => {
    const catalogue = catalogueWith({ kind: EAuthKind.Oauth, live: liveOf([LIVE_CARD]) })
    const ref = LIVE_CARD.ref
    const missing = { providerId: 'openai', modelId: 'nope' }

    expect(isRefReachable({ catalogue, ref })).toBe(true)
    expect(isRefReachable({ catalogue, ref: missing })).toBe(false)
    expect(catalogueLabel({ catalogue, ref })).toBe('Live Only')
    expect(catalogueLabel({ catalogue, ref: missing })).toBe('nope')
    expect(knownRefs(catalogue)).toContain('openai/gpt-live-only')
    expect(unmeasuredWindowWarning({ catalogue, ref })).toBeNull()
    expect(unmeasuredWindowWarning({ catalogue, ref: missing })).toContain('openai/nope')
    expect(unanswerableRef('x/y').message).toContain('x/y')
  })
})
