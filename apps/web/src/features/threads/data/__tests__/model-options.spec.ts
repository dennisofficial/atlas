import { describe, expect, it } from 'bun:test'

import { cardsForProvider } from '@dltech/atlas-models'

import { AUTO_MODEL_ID, modelOptionsOf } from '../model-options'

const account = (provider: string, status = 'active') => ({ provider, kind: 'oauth', status })

describe('modelOptionsOf', () => {
  it('lists Auto first, then only the connected providers in catalogue order', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('openai'), account('anthropic')],
    })
    expect(models[0]).toEqual({ id: AUTO_MODEL_ID, label: 'Atlas picks', auto: true })
    const providers = [...new Set(models.slice(1).map((model) => model.provider))]
    expect(providers).toEqual(['Anthropic', 'OpenAI'])
    expect(models.length - 1).toBe(
      cardsForProvider('anthropic').length + cardsForProvider('openai').length,
    )
    expect(reconnectProviders).toEqual([])
  })

  it('omits Auto when asked', () => {
    const { models } = modelOptionsOf({ accounts: [account('anthropic')], includeAuto: false })
    expect(models.some((model) => model.auto === true)).toBe(false)
  })

  it('turns a provider whose only accounts expired into a reconnect row without models', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('anthropic'), account('openai', 'expired')],
    })
    expect(reconnectProviders).toEqual(['OpenAI'])
    expect(models.some((model) => model.provider === 'OpenAI')).toBe(false)
  })

  it('keeps a provider connected when another account for it is still active', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('openai', 'expired'), account('openai', 'limited')],
    })
    expect(reconnectProviders).toEqual([])
    expect(models.some((model) => model.provider === 'OpenAI')).toBe(true)
  })

  it('ignores accounts for providers outside the catalogue', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('mystery'), account('mystery', 'expired')],
    })
    expect(models).toEqual([])
    expect(reconnectProviders).toEqual([])
  })

  it('has no models and no Auto without accounts', () => {
    expect(modelOptionsOf({ accounts: [] })).toEqual({ models: [], reconnectProviders: [] })
  })

  it('takes id, label, context and efforts from the card', () => {
    const card = cardsForProvider('anthropic').find((candidate) => candidate.effort !== undefined)
    const { models } = modelOptionsOf({ accounts: [account('anthropic')] })
    const option = models.find((model) => model.id === `anthropic/${card?.ref.modelId}`)
    expect(option?.label).toBe(card?.label)
    expect(option?.efforts?.length).toBeGreaterThan(0)
    expect(option?.context).toMatch(/^\d+(\.\d)?[kM]$/)
  })

  it('gives a card with no effort ladder an empty effort list', () => {
    const { models } = modelOptionsOf({ accounts: [account('openai')] })
    const bare = cardsForProvider('openai').find((card) => card.effort === undefined)
    expect(models.find((model) => model.id === `openai/${bare?.ref.modelId}`)?.efforts).toEqual([])
  })
})
