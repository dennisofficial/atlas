import { tool } from 'ai'
import { z } from 'zod'

import type { LanguageModelV4Prompt } from '@ai-sdk/provider'

import { type CredentialPort } from '@dltech/atlas-core'

import { apiKeyCredential, oauthCredential } from '../../credentials/testing'
import { createOpenAiModel } from '../openai-oauth'
import type { RecordingFetch } from './recording-fetch'

export const TEXT_RESPONSE = JSON.stringify({
  id: 'resp_stub',
  object: 'response',
  created_at: 1_767_225_600,
  status: 'completed',
  model: 'gpt-6.1',
  output: [
    {
      type: 'message',
      id: 'msg_stub',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'done', annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
})

export const TOOL_CALL_RESPONSE = JSON.stringify({
  id: 'resp_tool',
  object: 'response',
  created_at: 1_767_225_600,
  status: 'completed',
  model: 'gpt-6.1',
  output: [
    {
      type: 'reasoning',
      id: 'rs_live_1',
      summary: [],
      encrypted_content: 'enc_live_1',
    },
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'lookup',
      arguments: '{"city":"paris"}',
      status: 'completed',
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
})

export const lookupTool = () => ({
  lookup: tool({
    description: 'Look up a city',
    inputSchema: z.object({ city: z.string() }),
    execute: async ({ city }) => `weather in ${city}: sunny`,
  }),
})

export const apiCredentials = (): CredentialPort => ({
  read: async () => apiKeyCredential({ apiKey: 'sk-test' }),
  discard: async () => {},
})

export const subscriptionCredentials = (): CredentialPort => ({
  read: async () => oauthCredential({ accessToken: 'token-one', providerAccountId: 'acct-123' }),
  discard: async () => {},
})

export const openAiModel = (args: {
  credentials: CredentialPort
  fetch: RecordingFetch['fetch']
  providerId?: string
  modelId?: string
}) =>
  createOpenAiModel({
    credentials: args.credentials,
    providerId: args.providerId ?? 'openai',
    modelId: args.modelId ?? 'gpt-6.1',
    fetch: args.fetch,
  })

export type PromptMessage = LanguageModelV4Prompt[number]
export type AssistantContent = Extract<PromptMessage, { role: 'assistant' }>['content']

export const assistantWith = (content: AssistantContent): PromptMessage => ({
  role: 'assistant',
  content,
})

export const historyPrompt = (reasoning: AssistantContent): LanguageModelV4Prompt => [
  { role: 'user', content: [{ type: 'text', text: 'first question' }] },
  assistantWith(reasoning),
  assistantWith([
    { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { city: 'paris' } },
  ]),
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'lookup',
        output: { type: 'text', value: 'sunny' },
      },
    ],
  },
  { role: 'user', content: [{ type: 'text', text: 'and now?' }] },
]

export const callWithHistory = async (args: {
  recorder: RecordingFetch
  reasoning: AssistantContent
  credentials?: CredentialPort
  providerId?: string
  prompt?: LanguageModelV4Prompt
}): Promise<void> => {
  const model = openAiModel({
    credentials: args.credentials ?? apiCredentials(),
    fetch: args.recorder.fetch,
    ...(args.providerId === undefined ? {} : { providerId: args.providerId }),
  })
  await model.doGenerate({
    prompt: args.prompt ?? historyPrompt(args.reasoning),
  })
}

export const inputItems = (recorder: RecordingFetch, index: number): Record<string, unknown>[] => {
  const body = recorder.requests[index]?.body as { input: Record<string, unknown>[] }
  return body.input
}

export const reasoningItems = (items: Record<string, unknown>[]): Record<string, unknown>[] =>
  items.filter((item) => item.type === 'reasoning' || item.type === 'item_reference')
