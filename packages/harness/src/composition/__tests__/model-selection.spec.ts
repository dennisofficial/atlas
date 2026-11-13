import { describe, expect, it } from 'bun:test'

import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  catalogOf,
  EEffort,
  EImageTier,
  ERunFailureKind,
  findCard,
  type ModelCard,
} from '@dltech/atlas-core'
import { ProviderAdapter } from '@dltech/atlas-harness'

import { TurnFault } from '../../model/turn-fault'
import type { ModelCatalogue } from '../model-catalogue'
import { selectableModel } from '../model-selection'

const EMPTY_STREAM = () => new ReadableStream({ start: (controller) => controller.close() })

const NEVER_CALLED = () => Promise.reject(new Error('the stub model does not answer'))

const cardOf = (modelId: string): ModelCard => ({
  ref: { providerId: 'anthropic', modelId },
  label: modelId,
  api: 'messages',
  contextWindow: 200_000,
  imageTier: EImageTier.HighResolution,
  effort: { [EEffort.Low]: 'low', [EEffort.Medium]: 'medium', [EEffort.High]: 'high' },
})

const OPUS = cardOf('claude-opus-5')

const SONNET = cardOf('claude-sonnet-5')

const CATALOG = catalogOf([OPUS, SONNET])

class StreamingAdapter extends ProviderAdapter {
  readonly id = 'anthropic'
  readonly label = 'Claude Plan'

  cards(): readonly ModelCard[] {
    return [OPUS, SONNET]
  }

  effortOptions(): undefined {
    return undefined
  }

  model(args: { card: ModelCard }): LanguageModelV4 {
    return {
      specificationVersion: 'v4',
      provider: this.id,
      modelId: args.card.ref.modelId,
      supportedUrls: {},
      doGenerate: NEVER_CALLED,
      doStream: async () => ({ stream: EMPTY_STREAM() }),
    }
  }
}

const catalogueWhere = (args: { reachable: () => boolean }): ModelCatalogue => ({
  providers: [{ id: 'anthropic', label: 'Claude Plan', cards: [OPUS, SONNET] }],
  catalog: CATALOG,
  cardFor: (ref) => findCard({ catalog: CATALOG, ref }),
  adapterFor: () => new StreamingAdapter(),
  reachable: args.reachable,
  subscribed: () => false,
  observeAccounts: () => {},
  subscribe: () => () => {},
  version: () => 0,
})

const streamed = async (model: LanguageModelV4): Promise<unknown> =>
  await model.doStream({ prompt: [], abortSignal: new AbortController().signal })

describe('the model behind the switcher', () => {
  it('refuses every call while its provider has no account, and answers once it is connected', async () => {
    let connected = false
    const selectable = selectableModel({
      initial: { ref: OPUS.ref, effort: EEffort.Medium },
      catalogue: catalogueWhere({ reachable: () => connected }),
    })

    const fault = await streamed(selectable.model).catch((error: unknown) => error)

    expect(fault).toBeInstanceOf(TurnFault)
    expect(fault instanceof TurnFault ? fault.kind : undefined).toBe(
      ERunFailureKind.MissingCredential,
    )
    expect(fault instanceof Error ? fault.message : '').toBe(
      "Your main agent is set to claude-opus-5, but Anthropic isn't connected.",
    )

    connected = true
    expect(await streamed(selectable.model)).toBeDefined()
  })

  it('keeps a kept model whose provider is gone, and still refuses one no card answers for', () => {
    const selectable = selectableModel({
      initial: { ref: OPUS.ref, effort: EEffort.Medium },
      catalogue: catalogueWhere({ reachable: () => false }),
    })

    selectable.select({ ref: SONNET.ref, effort: EEffort.High })
    expect(selectable.choice().ref).toEqual(SONNET.ref)

    selectable.select({
      ref: { providerId: 'anthropic', modelId: 'claude-opus-3' },
      effort: EEffort.Low,
    })
    expect(selectable.choice().ref).toEqual(SONNET.ref)
  })
})
