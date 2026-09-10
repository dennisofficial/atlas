import { describe, expect, it } from 'bun:test'
import { streamText } from 'ai'

import { EEffort, EImageTier, findCard, type ModelCard } from '@dltech/atlas-core'

import {
  RefreshingCredentialPort,
  atlasVaultFile,
  atlasVaultKeyFile,
  builtinOauthClients,
  fileAccountStore,
} from '../../credentials'
import { generatedCatalogue } from '../../models/generated-catalogue'
import { SystemClock } from '../../store'
import { OpenAiAdapter } from '../openai-adapter'
import { bodyOnlyRecordingPassthroughFetch } from './recording-fetch'

export const LIVE_OPENAI_FLAG = 'ATLAS_LIVE_OPENAI'

const liveModelId = (): string => process.env.ATLAS_LIVE_OPENAI_MODEL ?? 'gpt-6-astra'

const liveAdapter = (fetch: typeof globalThis.fetch): OpenAiAdapter => {
  const clock = new SystemClock()
  const port = new RefreshingCredentialPort({
    accounts: fileAccountStore({ file: atlasVaultFile(), keyFile: atlasVaultKeyFile(), clock }),
    clients: builtinOauthClients({ clock }),
    clock,
    sinks: [],
  })
  const cards = [...generatedCatalogue().values()].filter(
    (card) => card.ref.providerId === 'openai',
  )

  return new OpenAiAdapter({ credentials: port, cards, fetch })
}

// The catalogue only lists models.dev API entries; the codex backend gates on the plan, so a
// plan-only model gets a bare card here — the cache gate keys off the model id alone.
const liveCard = (adapter: OpenAiAdapter, modelId: string): ModelCard =>
  findCard({ catalog: generatedCatalogue(), ref: { providerId: 'openai', modelId } }) ?? {
    ref: { providerId: 'openai', modelId },
    label: modelId,
    api: 'openai-responses',
    contextWindow: 400_000,
    imageTier: EImageTier.Standard,
  }

describe.skipIf(process.env[LIVE_OPENAI_FLAG] !== '1')(
  'a real exchange with the codex backend on the subscription credential',
  () => {
    const exchange = async (
      providerOptions?: Parameters<typeof streamText>[0]['providerOptions'],
    ) => {
      const recorder = bodyOnlyRecordingPassthroughFetch()
      const adapter = liveAdapter(recorder.fetch)
      const model = adapter.model({
        card: liveCard(adapter, liveModelId()),
        effort: () => EEffort.High,
      })
      const stream = streamText({
        model,
        prompt: 'Reply with exactly the word PONG.',
        ...(providerOptions === undefined ? {} : { providerOptions }),
      })

      let text = ''
      for await (const chunk of stream.textStream) text += chunk

      return { text, body: recorder.requests[0]?.body as Record<string, unknown> }
    }

    it('answers without ever sending prompt_cache_retention, which the backend 400s on', async () => {
      const { text, body } = await exchange()

      expect(text).toContain('PONG')
      expect(body['prompt_cache_retention']).toBeUndefined()
      expect(body['prompt_cache_options']).toBeUndefined()
    }, 120_000)

    it('accepts a prompt cache key', async () => {
      const { text, body } = await exchange({ openai: { promptCacheKey: 'atlas-live-probe' } })

      expect(text).toContain('PONG')
      expect(body['prompt_cache_key']).toBe('atlas-live-probe')
    }, 120_000)
  },
)
