import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { stepCountIs, streamText, tool, type ModelMessage } from 'ai'
import { z } from 'zod'

import {
  ATLAS_ALLOW_REAL_HOME_ENV,
  EEffort,
  EImageTier,
  findCard,
  type ModelCard,
} from '@dltech/atlas-core'

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
    // This spec reads the operator's real subscription credential out of the real Atlas home, so it
    // opts out of the test-home guard. It is gated behind ATLAS_LIVE_OPENAI and never runs in CI.
    beforeAll(() => {
      process.env[ATLAS_ALLOW_REAL_HOME_ENV] = '1'
    })

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

    it('filters historical reasoning and threads a tool call into the next step', async () => {
      const recorder = bodyOnlyRecordingPassthroughFetch()
      const adapter = liveAdapter(recorder.fetch)
      const model = adapter.model({
        card: liveCard(adapter, liveModelId()),
        effort: () => EEffort.High,
      })

      const atlasWarnings: string[] = []
      const sdkWarnings: string[] = []
      const warnSpy = spyOn(console, 'warn').mockImplementation((message?: unknown) => {
        const line = String(message)
        if (line.startsWith('atlas:')) atlasWarnings.push(line)
        else sdkWarnings.push(line)
      })
      afterEach(() => warnSpy.mockRestore())

      const collect = async (options: Parameters<typeof streamText>[0]) => {
        const stream = streamText(options)
        let text = ''
        for await (const chunk of stream.textStream) text += chunk
        return { text, response: await stream.response, steps: await stream.steps }
      }

      const first = await collect({
        model,
        prompt: 'Think through the problem first, then call the lookup tool for the city "paris".',
        tools: {
          lookup: tool({
            description: 'Look up a city',
            inputSchema: z.object({ city: z.string() }),
            execute: async ({ city }) => `weather in ${city}: sunny`,
          }),
        },
        stopWhen: stepCountIs(2),
        providerOptions: { openai: { reasoningEffort: 'high', reasoningSummary: 'detailed' } },
      })

      const firstAssistant = first.response.messages.find((message) => message.role === 'assistant')
      expect(firstAssistant).toBeDefined()

      // response.messages holds only the final text message; the tool call and its result live in
      // the steps. The subscription backend streams a reasoning summary but the SDK never attaches
      // encrypted content to it, and a fabricated ciphertext fails server-side verification — so no
      // native replayable part can be produced here. What the live path can prove is that foreign
      // and bare reasoning are filtered out and the turn still completes with tool calls intact.
      const toolMessages = first.steps.flatMap((step) => step.response.messages)
      const history: ModelMessage[] = [
        { role: 'user', content: 'earlier exchange' },
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              text: 'an anthropic thought from a previous session',
              providerOptions: { anthropic: { signature: 'sig-live' } },
            },
            { type: 'reasoning', text: 'a bare thought with no provenance' },
            { type: 'text', text: 'the earlier answer' },
          ],
        },
        ...toolMessages,
        { role: 'user', content: 'What did the tool report? Answer in one short sentence.' },
      ]

      const followUp = await collect({ model, messages: history })
      expect(followUp.text.length).toBeGreaterThan(0)

      expect(recorder.requests.length).toBeGreaterThanOrEqual(2)
      const finalBody = recorder.requests[recorder.requests.length - 1]?.body as {
        input: Record<string, unknown>[]
      }
      const items = finalBody.input

      expect(items.some((item) => item.type === 'function_call')).toBe(true)
      expect(items.some((item) => item.type === 'function_call_output')).toBe(true)

      const reasoningItems = items.filter(
        (item) => item.type === 'reasoning' || item.type === 'item_reference',
      )
      for (const item of reasoningItems) {
        const summary = item['summary'] as { text: string }[] | undefined
        expect(
          (summary ?? []).some((entry) => entry.text.includes('anthropic thought')),
        ).toBe(false)
        expect((summary ?? []).some((entry) => entry.text.includes('bare thought'))).toBe(false)
      }

      expect(atlasWarnings.length).toBeGreaterThanOrEqual(1)
      expect(atlasWarnings[0]).toContain('omitted 2 historical reasoning part(s)')
      expect(atlasWarnings[0]).not.toContain('anthropic thought')
      expect(sdkWarnings).toEqual([])
    }, 240_000)
  },
)
