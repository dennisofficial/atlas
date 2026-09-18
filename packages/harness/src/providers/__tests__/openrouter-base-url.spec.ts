import { afterEach, describe, expect, it } from 'bun:test'

import {
  EAuthKind,
  EImageTier,
  type Credential,
  type CredentialPort,
  type EEffort,
  type ModelCard,
} from '@dltech/atlas-core'

import { OpenRouterAdapter, OPENROUTER_PROVIDER_ID } from '../openrouter-adapter'

const card: ModelCard = {
  ref: { providerId: OPENROUTER_PROVIDER_ID, modelId: 'a-model' },
  label: 'A model',
  api: 'openai-completions',
  contextWindow: 200_000,
  imageTier: EImageTier.Standard,
}

const credentials: CredentialPort = {
  read: async (): Promise<Credential> => ({
    kind: EAuthKind.ApiKey,
    accountId: 'acc_1' as Credential['accountId'],
    apiKey: 'k',
  }),
  discard: async () => undefined,
}

const effort = (): EEffort => 'medium' as EEffort

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('openrouter base url', () => {
  it('defaults to the hosted endpoint', async () => {
    let called = ''
    globalThis.fetch = (async (input: unknown) => {
      called = String(input)
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const adapter = new OpenRouterAdapter({ credentials, cards: [card] })
    await adapter.model({ card, effort }).doGenerate({ prompt: [] })

    expect(called).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('takes a base url override, so a local gateway can stand in for the hosted one', async () => {
    let called = ''
    globalThis.fetch = (async (input: unknown) => {
      called = String(input)
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        { headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const adapter = new OpenRouterAdapter({
      credentials,
      cards: [card],
      baseUrl: 'http://localhost:3002/v1',
    })
    await adapter.model({ card, effort }).doGenerate({ prompt: [] })

    expect(called).toBe('http://localhost:3002/v1/chat/completions')
  })
})
