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
import { cardsForProvider, OpenAiAdapter, OPENAI_PROVIDER_ID } from '@dltech/atlas-harness'

import { modelCatalogue, type LiveCards } from '../model-catalogue'
import { alwaysAuthorised } from './fakes'

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
  ref: { providerId: OPENAI_PROVIDER_ID, modelId: 'gpt-live-only' },
  label: 'Live Only',
  api: 'openai-responses',
  contextWindow: 123_000,
  imageTier: EImageTier.Standard,
}

const liveOf = (cards: readonly ModelCard[] | undefined) => {
  const listeners = new Set<() => void>()
  let refreshes = 0
  const live: LiveCards = {
    cards: () => cards,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refresh: async () => {
      refreshes += 1
    },
  }
  return { live, fire: () => listeners.forEach((listener) => listener()), refreshes: () => refreshes }
}

const catalogueWith = (args: { kind: EAuthKind; live: LiveCards }) =>
  modelCatalogue({
    adapters: [
      new OpenAiAdapter({
        credentials: alwaysAuthorised(),
        cards: cardsForProvider(OPENAI_PROVIDER_ID),
      }),
    ],
    accounts: [account(args.kind)],
    live: args.live,
  })

const openAiCards = (catalogue: ReturnType<typeof catalogueWith>) =>
  catalogue.providers.find((provider) => provider.id === OPENAI_PROVIDER_ID)?.cards ?? []

describe('live codex cards in the catalogue', () => {
  it('uses the live list for a ChatGPT login, in the picker and the card lookup', () => {
    const catalogue = catalogueWith({ kind: EAuthKind.Oauth, live: liveOf([LIVE_CARD]).live })

    expect(openAiCards(catalogue)).toEqual([LIVE_CARD])
    expect(catalogue.cardFor(LIVE_CARD.ref)).toEqual(LIVE_CARD)
    expect(catalogue.cardFor({ providerId: OPENAI_PROVIDER_ID, modelId: 'gpt-4.1' })).toBeUndefined()
  })

  it('falls back to the static list while no live cards exist', () => {
    const catalogue = catalogueWith({ kind: EAuthKind.Oauth, live: liveOf(undefined).live })

    expect(openAiCards(catalogue).length).toBeGreaterThan(1)
    expect(catalogue.cardFor({ providerId: OPENAI_PROVIDER_ID, modelId: 'gpt-4.1' })).toBeDefined()
  })

  it('keeps the static list for an API key even when live cards exist', () => {
    const catalogue = catalogueWith({ kind: EAuthKind.ApiKey, live: liveOf([LIVE_CARD]).live })

    expect(openAiCards(catalogue)).not.toContainEqual(LIVE_CARD)
    expect(catalogue.cardFor(LIVE_CARD.ref)).toBeUndefined()
  })

  it('bumps the version and notifies subscribers when the live catalogue changes', () => {
    const { live, fire } = liveOf([LIVE_CARD])
    const catalogue = catalogueWith({ kind: EAuthKind.Oauth, live })
    let heard = 0
    catalogue.subscribe(() => (heard += 1))
    const before = catalogue.version()

    fire()

    expect(catalogue.version()).toBe(before + 1)
    expect(heard).toBe(1)
  })

  it('refreshes the live catalogue when accounts change to one holding a ChatGPT login', () => {
    const { live, refreshes } = liveOf([LIVE_CARD])
    const catalogue = catalogueWith({ kind: EAuthKind.ApiKey, live })

    catalogue.observeAccounts([account(EAuthKind.ApiKey)])
    expect(refreshes()).toBe(0)

    catalogue.observeAccounts([account(EAuthKind.Oauth)])
    expect(refreshes()).toBe(1)
    expect(openAiCards(catalogue)).toEqual([LIVE_CARD])
  })
})
