import { describe, expect, it } from 'bun:test'

import {
  CONTEXT_WINDOW_UNMEASURED,
  EImageTier,
  contextWindowOf,
  imageTierOf,
  toolImagesCarriedBy,
  type ModelCard,
} from '@dltech/atlas-core'

import { FaultingModelPort } from '../faulting-model'
import { AiSdkModelPort } from '../ai-sdk-model-port'

const cardOf = (args: { modelId: string; contextWindow: number; tier: EImageTier }): ModelCard => ({
  ref: { providerId: 'anthropic', modelId: args.modelId },
  label: args.modelId,
  api: 'anthropic-messages',
  contextWindow: args.contextWindow,
  imageTier: args.tier,
})

const KIMI_ON_OPENROUTER: ModelCard = {
  ...cardOf({ modelId: 'moonshotai/kimi-k2', contextWindow: 262_144, tier: EImageTier.Standard }),
  ref: { providerId: 'openrouter', modelId: 'moonshotai/kimi-k2' },
  api: 'openai-completions',
}

const OPUS = cardOf({
  modelId: 'claude-opus-5',
  contextWindow: 1_000_000,
  tier: EImageTier.HighResolution,
})

const HAIKU = cardOf({
  modelId: 'claude-haiku-4-5',
  contextWindow: 200_000,
  tier: EImageTier.Standard,
})

const stub = { specificationVersion: 'v4', provider: 'anthropic', modelId: 'x' } as never

describe('the window a port reports', () => {
  it('follows the switcher, because the card is read per turn rather than captured', () => {
    let chosen = OPUS
    const port = new AiSdkModelPort({ model: stub, card: () => chosen })

    expect(contextWindowOf(port)).toBe(1_000_000)
    expect(imageTierOf(port)).toBe(EImageTier.HighResolution)

    chosen = HAIKU
    expect(contextWindowOf(port)).toBe(200_000)
    expect(imageTierOf(port)).toBe(EImageTier.Standard)
  })

  it('survives the fault-injecting decorator, which the turn loop reads through', () => {
    const inner = new AiSdkModelPort({ model: stub, card: OPUS })
    const faulting = new FaultingModelPort({ inner, spec: { times: 1, status: 529 } })

    expect(contextWindowOf(faulting)).toBe(1_000_000)
    expect(imageTierOf(faulting)).toBe(EImageTier.HighResolution)
  })

  it('reads unmeasured when no card was supplied, which switches auto-compact off', () => {
    const port = new AiSdkModelPort({ model: stub })

    expect(contextWindowOf(port)).toBe(CONTEXT_WINDOW_UNMEASURED)
  })
})

describe('the tool-image transport a port reports', () => {
  it('refuses a completions-API card, whose provider stringifies tool-result images into text', () => {
    const port = new AiSdkModelPort({ model: stub, card: KIMI_ON_OPENROUTER })

    expect(toolImagesCarriedBy(port)).toBe(false)
  })

  it('carries them on the messages and responses APIs', () => {
    expect(toolImagesCarriedBy(new AiSdkModelPort({ model: stub, card: OPUS }))).toBe(true)

    const gpt: ModelCard = { ...OPUS, api: 'openai-responses' }
    expect(toolImagesCarriedBy(new AiSdkModelPort({ model: stub, card: gpt }))).toBe(true)
  })

  it('carries them when no card was supplied, preserving the status quo', () => {
    expect(toolImagesCarriedBy(new AiSdkModelPort({ model: stub }))).toBe(true)
  })
})
