import { describe, expect, it } from 'bun:test'

import { EImageTier } from '@dltech/atlas-core'
import { cardsForProvider, withoutDatedDuplicates } from '@dltech/atlas-models'

import { modelOptionsOf } from '../model-options'

const account = (provider: string, status = 'active') => ({ provider, kind: 'oauth', status })

const CLAUDE = 'Claude Plan'
const CODEX = 'Codex Plan'
const ALL_LABELS = [CLAUDE, CODEX, 'OpenRouter', 'Inference.net']
const selectable = (options: { disabled?: boolean }[]) =>
  options.filter((option) => option.disabled !== true)
const countOf = (provider: string) => withoutDatedDuplicates(cardsForProvider(provider)).length

describe('modelOptionsOf', () => {
  it('lists all four providers in catalogue order, unconnected ones disabled', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('openai'), account('anthropic')],
    })
    expect([...new Set(models.map((model) => model.provider))]).toEqual(ALL_LABELS)
    expect(selectable(models)).toHaveLength(countOf('anthropic') + countOf('openai'))
    expect(reconnectProviders).toEqual([])
  })

  it('marks providers without an account disabled with a no-key note', () => {
    const { models } = modelOptionsOf({ accounts: [account('anthropic')] })
    const dormant = models.filter((model) => model.provider !== CLAUDE)
    expect(dormant.length).toBeGreaterThan(0)
    expect(dormant.every((model) => model.disabled === true)).toBe(true)
    expect(dormant.every((model) => model.disabledNote === 'no key')).toBe(true)
    expect(
      models.filter((model) => model.provider === CLAUDE).every((model) => !model.disabled),
    ).toBe(true)
  })

  it('turns a provider whose only accounts expired into a reconnect row without models', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('anthropic'), account('openai', 'expired')],
    })
    expect(reconnectProviders).toEqual([CODEX])
    expect(models.some((model) => model.provider === CODEX)).toBe(false)
  })

  it('keeps a provider connected when another account for it is still active', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('openai', 'expired'), account('openai', 'limited')],
    })
    expect(reconnectProviders).toEqual([])
    expect(selectable(models.filter((model) => model.provider === CODEX))).toHaveLength(
      countOf('openai'),
    )
  })

  it('ignores accounts for providers outside the catalogue', () => {
    const { models, reconnectProviders } = modelOptionsOf({
      accounts: [account('mystery'), account('mystery', 'expired')],
    })
    expect(selectable(models)).toEqual([])
    expect(reconnectProviders).toEqual([])
  })

  it('offers every provider disabled without accounts', () => {
    const { models, reconnectProviders } = modelOptionsOf({ accounts: [] })
    expect([...new Set(models.map((model) => model.provider))]).toEqual(ALL_LABELS)
    expect(selectable(models)).toEqual([])
    expect(reconnectProviders).toEqual([])
  })

  it('drops dated aliases that a plain alias already covers', () => {
    const raw = cardsForProvider('anthropic')
    const { models } = modelOptionsOf({ accounts: [account('anthropic')] })
    const ids = models.filter((model) => model.provider === CLAUDE).map((model) => model.id)
    expect(ids.length).toBe(countOf('anthropic'))
    expect(ids.length).toBeLessThan(raw.length)
  })

  it('maps the card image tier onto the image-support flag', () => {
    const { models } = modelOptionsOf({ accounts: [account('anthropic'), account('openai')] })
    const cards = [...cardsForProvider('anthropic'), ...cardsForProvider('openai')]
    const high = cards.find((card) => card.imageTier === EImageTier.HighResolution)
    const standard = cards.find((card) => card.imageTier === EImageTier.Standard)
    const idOf = (card: typeof high) => `${card?.ref.providerId}/${card?.ref.modelId}`
    expect(models.find((model) => model.id === idOf(high))?.images).toBe(true)
    expect(models.find((model) => model.id === idOf(standard))?.images).toBe(false)
  })

  it('takes id, label, context and efforts from the card', () => {
    const card = cardsForProvider('anthropic').find((candidate) => candidate.effort !== undefined)
    const { models } = modelOptionsOf({ accounts: [account('anthropic')] })
    const option = models.find((model) => model.id === `anthropic/${card?.ref.modelId}`)
    expect(option?.label).toBe(card?.label)
    expect(option?.efforts?.length).toBeGreaterThan(0)
    expect(option?.context).toMatch(/^\d+(\.\d)?[kM]$/)
  })

  it('shows the output price per million from the card', () => {
    const card = cardsForProvider('anthropic').find((candidate) => candidate.cost !== undefined)
    const { models } = modelOptionsOf({ accounts: [account('anthropic')] })
    const option = models.find((model) => model.id === `anthropic/${card?.ref.modelId}`)
    expect(option?.rate).toBe(`$${card?.cost?.outputPerMillion.toFixed(2)}/M`)
  })

  it('gives a card with no effort ladder an empty effort list', () => {
    const { models } = modelOptionsOf({ accounts: [account('openai')] })
    const bare = cardsForProvider('openai').find((card) => card.effort === undefined)
    expect(models.find((model) => model.id === `openai/${bare?.ref.modelId}`)?.efforts).toEqual([])
  })

  it('keeps a thread model whose provider is no longer offered selectable', () => {
    const card = cardsForProvider('anthropic')[0]
    const id = `anthropic/${card?.ref.modelId}`
    const { models } = modelOptionsOf({ accounts: [account('openai')], currentId: id })
    expect(models.find((model) => model.id === id)?.label).toBe(card?.label)
    const unknown = modelOptionsOf({ accounts: [account('openai')], currentId: 'x/y' })
    expect(unknown.models.find((model) => model.id === 'x/y')?.label).toBe('x/y')
  })

  it('does not duplicate a current model that is already offered', () => {
    const card = cardsForProvider('anthropic')[0]
    const id = `anthropic/${card?.ref.modelId}`
    const { models } = modelOptionsOf({ accounts: [account('anthropic')], currentId: id })
    expect(models.filter((model) => model.id === id)).toHaveLength(1)
  })
})
