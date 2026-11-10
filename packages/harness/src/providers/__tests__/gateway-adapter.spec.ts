import { describe, expect, it } from 'bun:test'
import { generateText } from 'ai'

import { EEffort, EImageTier, type CredentialPort, type ModelCard } from '@dltech/atlas-core'

import { apiKeyCredential } from '../../credentials/testing'
import { GatewayAdapter, GATEWAY_PROVIDER_ID } from '../gateway-adapter'
import { recordingFetch } from './recording-fetch'

const RESULT_JSON = JSON.stringify({
  content: [{ type: 'text', text: 'pong' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
})

const credentials: CredentialPort = {
  read: async () => apiKeyCredential({ apiKey: 'vck_test' }),
  discard: async () => undefined,
}

const card: ModelCard = {
  ref: { providerId: GATEWAY_PROVIDER_ID, modelId: 'moonshotai/kimi-k3-fast' },
  label: 'Kimi K3 Fast',
  api: 'ai-gateway',
  contextWindow: 1_000_000,
  imageTier: EImageTier.Standard,
  effort: { [EEffort.Off]: 'none', [EEffort.Low]: 'low', [EEffort.High]: 'high' },
}

const anthropicCard: ModelCard = {
  ...card,
  ref: { providerId: GATEWAY_PROVIDER_ID, modelId: 'anthropic/claude-opus-5-5' },
  label: 'Claude Opus 5.5',
}

const ask = async (args: {
  effort: EEffort
  card?: ModelCard
  providerOptions?: Record<string, Record<string, string>>
}) => {
  const chosen = args.card ?? card
  const recorder = recordingFetch({ body: RESULT_JSON, contentType: 'application/json' })
  const adapter = new GatewayAdapter({ credentials, cards: [chosen], fetch: recorder.fetch })
  const result = await generateText({
    model: adapter.model({ card: chosen, effort: () => args.effort }),
    prompt: 'ping',
    ...(args.providerOptions === undefined ? {} : { providerOptions: args.providerOptions }),
  })
  const request = recorder.requests[0]
  if (request === undefined) throw new Error('the gateway was never called')
  return { result, request }
}

describe('the gateway adapter', () => {
  it('names the model and authorizes with the stored key', async () => {
    const { result, request } = await ask({ effort: EEffort.High })

    expect(result.text).toBe('pong')
    expect(request.url).toBe('https://ai-gateway.vercel.sh/v4/ai/language-model')
    expect(request.headers.get('authorization')).toBe('Bearer vck_test')
    expect(request.headers.get('ai-language-model-id')).toBe('moonshotai/kimi-k3-fast')
  })

  it('sends the clamped effort rung as the reasoning option', async () => {
    const { request } = await ask({ effort: EEffort.Medium })
    expect(request.body).toMatchObject({ reasoning: 'high' })
  })

  it('turns automatic caching on while keeping routing options the caller set', async () => {
    const { request } = await ask({
      effort: EEffort.Off,
      providerOptions: { [GATEWAY_PROVIDER_ID]: { order: 'vertex' } },
    })

    expect(request.body).toMatchObject({
      reasoning: 'none',
      providerOptions: { [GATEWAY_PROVIDER_ID]: { caching: 'auto', order: 'vertex' } },
    })
  })

  it('leaves anthropic markers to the assembler, which already places its own', async () => {
    const { request } = await ask({ effort: EEffort.Off, card: anthropicCard })

    expect(request.body).toMatchObject({ providerOptions: { [GATEWAY_PROVIDER_ID]: {} } })
  })

  it('carries the session id the assembler pinned to the thread', async () => {
    const { request } = await ask({
      effort: EEffort.Off,
      providerOptions: { [GATEWAY_PROVIDER_ID]: { sessionId: 'brn_session' } },
    })

    expect(request.body).toMatchObject({
      providerOptions: { [GATEWAY_PROVIDER_ID]: { caching: 'auto', sessionId: 'brn_session' } },
    })
  })

  it('answers every url the gateway can fetch itself', () => {
    const adapter = new GatewayAdapter({ credentials, cards: [card] })
    const model = adapter.model({ card, effort: () => EEffort.High })
    expect(Object.keys(model.supportedUrls)).toEqual(['*/*'])
  })
})
