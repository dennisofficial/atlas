import { describe, expect, it } from 'bun:test'
import { generateText, streamText } from 'ai'

import { EEffort, EImageTier, type CredentialPort, type ModelCard } from '@dltech/atlas-core'

import { apiKeyCredential, oauthCredential } from '../../credentials/testing'
import { AnthropicAdapter } from '../anthropic-adapter'
import { OpenAiAdapter } from '../openai-adapter'
import { recordingFetch, refusingFirstFetch, streamedText } from './recording-fetch'

const oauth: CredentialPort = {
  read: async () => oauthCredential({ accessToken: 'token' }),
  discard: async () => undefined,
}

const apiKey: CredentialPort = {
  read: async () => apiKeyCredential({ apiKey: 'sk-test' }),
  discard: async () => undefined,
}

const claudeCard = (fast: boolean): ModelCard => ({
  ref: { providerId: 'anthropic', modelId: 'claude-opus-5-5' },
  label: 'opus-5.5',
  api: 'anthropic-messages',
  contextWindow: 1_000_000,
  imageTier: EImageTier.HighResolution,
  ...(fast ? { fast: true } : {}),
})

const codexCard = (fast: boolean): ModelCard => ({
  ref: { providerId: 'openai', modelId: 'gpt-6.1-sol' },
  label: 'gpt-6.1-sol',
  api: 'openai-responses',
  contextWindow: 400_000,
  imageTier: EImageTier.Standard,
  ...(fast ? { fast: true } : {}),
})

const RATE_LIMITED = JSON.stringify({
  type: 'error',
  error: { type: 'rate_limit_error', message: 'Fast mode rate limit exceeded.' },
})

const claudeExchange = async (args: { card: ModelCard; fast: boolean }) => {
  const recorder = recordingFetch({ body: streamedText('pong') })
  const adapter = new AnthropicAdapter({
    credentials: oauth,
    cards: [args.card],
    fetch: recorder.fetch,
  })
  const model = adapter.model({
    card: args.card,
    effort: () => EEffort.Medium,
    fast: () => args.fast,
  })
  await streamText({ model, prompt: 'ping', maxRetries: 0 }).text
  return recorder.requests[0]
}

describe('fast mode on a Claude model', () => {
  it('asks for fast speed under the fast-mode beta, keeping the oauth beta', async () => {
    const request = await claudeExchange({ card: claudeCard(true), fast: true })

    expect(request?.body).toMatchObject({ speed: 'fast' })
    const betas = request?.headers.get('anthropic-beta')?.split(',') ?? []
    expect(betas).toContain('fast-mode-2026-02-01')
    expect(betas).toContain('oauth-2025-04-20')
  })

  it('sends standard speed while the conversation has fast off', async () => {
    const request = await claudeExchange({ card: claudeCard(true), fast: false })
    expect(request?.body).not.toHaveProperty('speed')
  })

  it('never sends fast to a model that does not offer it, whatever the toggle says', async () => {
    const request = await claudeExchange({ card: claudeCard(false), fast: true })
    expect(request?.body).not.toHaveProperty('speed')
  })

  it('answers a refused fast request at standard speed and says fast was refused', async () => {
    const recorder = refusingFirstFetch({
      body: streamedText('pong'),
      status: 429,
      refusalBody: RATE_LIMITED,
    })
    const card = claudeCard(true)
    const adapter = new AnthropicAdapter({
      credentials: oauth,
      cards: [card],
      fetch: recorder.fetch,
    })
    let refused = 0
    let fast = true
    const model = adapter.model({
      card,
      effort: () => EEffort.Medium,
      fast: () => fast,
      onFastRefused: () => {
        refused += 1
        fast = false
      },
    })

    expect(await streamText({ model, prompt: 'ping', maxRetries: 0 }).text).toBe('pong')
    expect(refused).toBe(1)
    expect(recorder.requests[0]?.body).toMatchObject({ speed: 'fast' })
    expect(recorder.requests[1]?.body).not.toHaveProperty('speed')
  })
})

const RESPONSE_JSON = JSON.stringify({
  id: 'resp_stub',
  object: 'response',
  created_at: 1_767_225_600,
  status: 'completed',
  model: 'gpt-6.1-sol',
  output: [
    {
      type: 'message',
      id: 'msg_stub',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'pong', annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
})

const codexExchange = async (args: { card: ModelCard; fast: boolean }) => {
  const recorder = recordingFetch({ body: RESPONSE_JSON, contentType: 'application/json' })
  const adapter = new OpenAiAdapter({
    credentials: apiKey,
    cards: [args.card],
    fetch: recorder.fetch,
  })
  const model = adapter.model({
    card: args.card,
    effort: () => EEffort.High,
    fast: () => args.fast,
  })
  await generateText({ model, prompt: 'ping' })
  return recorder.requests[0]?.body
}

describe('fast mode on a Codex model', () => {
  it('asks for the priority service tier, the value the backend accepts for fast', async () => {
    expect(await codexExchange({ card: codexCard(true), fast: true })).toMatchObject({
      service_tier: 'priority',
    })
  })

  it('sends no tier while fast is off, even for a model whose plan lists it', async () => {
    expect(await codexExchange({ card: codexCard(true), fast: false })).not.toHaveProperty(
      'service_tier',
    )
  })

  it('sends no tier to a model that lists none', async () => {
    expect(await codexExchange({ card: codexCard(false), fast: true })).not.toHaveProperty(
      'service_tier',
    )
  })
})
