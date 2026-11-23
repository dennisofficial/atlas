import { describe, expect, test } from 'bun:test'

import { EEffort, EImageTier, supportedEfforts } from '@dltech/atlas-core'

import { cardOf, providersOf, reachableOf } from '../models-catalogue'
import type { ModelsEntry, ModelsReply } from '../session-api'

const CONNECTED = 'connected' as ModelsReply['providers'][number]['status']

const entryOf = (over: Partial<ModelsEntry>): ModelsEntry => ({
  id: 'anthropic/claude-x',
  label: 'Claude X',
  contextWindow: 200_000,
  efforts: [],
  ...over,
})

const replyOf = (models: readonly ModelsEntry[]): ModelsReply => ({
  providers: [
    { id: 'anthropic', label: 'Anthropic', status: CONNECTED, live: false, models: [...models] },
  ],
})

describe('cardOf', () => {
  test('keeps the rungs as the card offers them, and fast only when true', () => {
    const card = cardOf({
      entry: entryOf({
        efforts: ['low', 'high'],
        fast: true,
        inputPerMillion: 3,
        outputPerMillion: 15,
      }),
    })
    expect(card).not.toBeNull()
    expect(supportedEfforts(card?.effort)).toEqual([EEffort.Low, EEffort.High])
    expect(card?.fast).toBe(true)
    expect(card?.cost).toEqual({ inputPerMillion: 3, outputPerMillion: 15 })
  })

  test('a rung outside the ladder is dropped', () => {
    const card = cardOf({ entry: entryOf({ efforts: ['low', 'ludicrous'] }) })
    expect(supportedEfforts(card?.effort)).toEqual([EEffort.Low])
  })

  test('an id with no provider separator is dropped', () => {
    expect(cardOf({ entry: entryOf({ id: 'claude-x' }) })).toBeNull()
  })

  test('the image tier is a known tier or the standard one', () => {
    expect(cardOf({ entry: entryOf({ imageTier: 'high-resolution' }) })?.imageTier).toBe(
      EImageTier.HighResolution,
    )
    expect(cardOf({ entry: entryOf({ imageTier: 'enormous' }) })?.imageTier).toBe(
      EImageTier.Standard,
    )
    expect(cardOf({ entry: entryOf({}) })?.imageTier).toBe(EImageTier.Standard)
  })

  test('cost is kept only when both prices are numbers', () => {
    expect(cardOf({ entry: entryOf({ inputPerMillion: 3 }) })?.cost).toBeUndefined()
  })
})

describe('providersOf and reachableOf', () => {
  test('one provider per response provider, dropping the cards that cannot be built', () => {
    const providers = providersOf({
      models: replyOf([entryOf({}), entryOf({ id: 'no-separator' })]),
    })
    expect(providers.map((provider) => provider.id)).toEqual(['anthropic'])
    expect(providers[0]?.cards).toHaveLength(1)
  })

  test('only a connected provider is reachable', () => {
    const models: ModelsReply = {
      providers: [
        ...replyOf([entryOf({})]).providers,
        {
          id: 'openai',
          label: 'OpenAI',
          status: 'expired' as ModelsReply['providers'][number]['status'],
          live: false,
          models: [],
        },
      ],
    }
    const reachable = reachableOf({ models })
    expect([...reachable]).toEqual(['anthropic'])
  })
})
