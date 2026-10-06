import { describe, expect, it } from 'bun:test'
import { generateText } from 'ai'

import { apiKeyCredential } from '../../credentials/testing'
import { createOpenAiModel } from '../openai-oauth'
import { recordingFetch } from './recording-fetch'

const JSON_RESPONSE = JSON.stringify({
  id: 'resp_stub',
  object: 'response',
  created_at: 1_767_225_600,
  status: 'completed',
  model: 'gpt-5.1-codex',
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

describe('generation on an api key', () => {
  it('stays a plain request answered with JSON, never a stream', async () => {
    const recorder = recordingFetch({ body: JSON_RESPONSE, contentType: 'application/json' })
    const model = createOpenAiModel({
      credentials: {
        read: async () => apiKeyCredential({ apiKey: 'sk-test' }),
        discard: async () => {},
      },
      providerId: 'openai',
      modelId: 'gpt-5.1-codex',
      fetch: recorder.fetch,
    })

    expect((await generateText({ model, prompt: 'ping' })).text).toBe('pong')

    const body = recorder.requests[0]?.body as Record<string, unknown>
    expect(body['stream']).not.toBe(true)
  })
})
