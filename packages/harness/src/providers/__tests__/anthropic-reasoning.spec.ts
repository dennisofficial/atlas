import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import type { LanguageModelV4Prompt } from '@ai-sdk/provider'

import { type CredentialPort } from '@dltech/atlas-core'

import { apiKeyCredential, oauthCredential } from '../../credentials/testing'
import { createAnthropicOauthModel } from '../anthropic-oauth'
import { generatedText, recordingFetch, type RecordingFetch } from './recording-fetch'

type PromptMessage = LanguageModelV4Prompt[number]
type AssistantContent = Extract<PromptMessage, { role: 'assistant' }>['content']

const apiCredentials = (): CredentialPort => ({
  read: async () => apiKeyCredential({ apiKey: 'sk-ant-test' }),
  discard: async () => {},
})

const subscriptionCredentials = (): CredentialPort => ({
  read: async () => oauthCredential({ accessToken: 'token-one' }),
  discard: async () => {},
})

const historyPrompt = (reasoning: AssistantContent): LanguageModelV4Prompt => [
  { role: 'user', content: [{ type: 'text', text: 'first question' }] },
  { role: 'assistant', content: reasoning },
  {
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { city: 'paris' } }],
  },
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

const callWithHistory = async (args: {
  recorder: RecordingFetch
  reasoning: AssistantContent
  credentials?: CredentialPort
  prompt?: LanguageModelV4Prompt
}): Promise<void> => {
  const model = createAnthropicOauthModel({
    credentials: args.credentials ?? apiCredentials(),
    modelId: 'claude-opus-5',
    fetch: args.recorder.fetch,
  })
  await model.doGenerate({
    prompt: args.prompt ?? historyPrompt(args.reasoning),
  })
}

type AnthropicBlock = Record<string, unknown>

const anthropicMessages = (recorder: RecordingFetch, index: number): { role: string; content: AnthropicBlock[] }[] => {
  const body = recorder.requests[index]?.body as { messages: { role: string; content: AnthropicBlock[] }[] }
  return body.messages
}

const assistantMessages = (recorder: RecordingFetch, index: number) =>
  anthropicMessages(recorder, index).filter((message) => message.role === 'assistant')

const thinkingBlocks = (recorder: RecordingFetch, index: number): AnthropicBlock[] =>
  anthropicMessages(recorder, index).flatMap((message) =>
    message.content.filter((block) => block.type === 'thinking' || block.type === 'redacted_thinking'),
  )

describe('anthropic history reasoning compatibility', () => {
  const warnings: string[] = []
  let warnSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    warnSpy?.mockRestore()
    warnings.length = 0
  })

  const watchWarnings = (): void => {
    warnSpy = spyOn(console, 'warn').mockImplementation((message?: unknown) => {
      warnings.push(String(message))
    })
  }

  it('drops unsigned reasoning with one concise warning and keeps the rest of the turn', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        { type: 'reasoning', text: 'reasoning text that must never reach a log' },
        { type: 'text', text: 'here is the answer' },
      ],
    })

    expect(thinkingBlocks(recorder, 0)).toEqual([])
    // The converter merges consecutive assistant messages, so the surviving text and the
    // tool_use from the next assistant turn share one message.
    const merged = assistantMessages(recorder, 0).flatMap((message) => message.content)
    expect(merged).toEqual([
      { type: 'text', text: 'here is the answer' },
      expect.objectContaining({ type: 'tool_use', name: 'lookup' }),
    ])

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('atlas: omitted 1 historical reasoning part(s)')
    expect(warnings[0]).toContain('no Anthropic signature')
    expect(warnings[0]).not.toContain('reasoning text that must never reach a log')
  })

  it('drops reasoning stamped by another provider', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        {
          type: 'reasoning',
          text: 'encrypted elsewhere',
          providerOptions: { openai: { itemId: 'rs_abc', reasoningEncryptedContent: 'enc_abc' } },
        },
        { type: 'text', text: 'still answered' },
      ],
    })

    expect(thinkingBlocks(recorder, 0)).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('atlas: omitted 1 historical reasoning part(s)')
  })

  it('drops an assistant message left empty once its only part was reasoning', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [{ type: 'reasoning', text: 'only a thought', providerOptions: {} }],
    })

    // The emptied reasoning-only message is gone; the surviving assistant content is the
    // tool_use from the following turn, merged into a single message by the converter.
    const merged = assistantMessages(recorder, 0).flatMap((message) => message.content)
    expect(merged).toEqual([expect.objectContaining({ type: 'tool_use', name: 'lookup' })])
  })

  it('does not mutate the canonical history prompt it was handed', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })
    const prompt = historyPrompt([
      { type: 'reasoning', text: 'ephemeral', providerOptions: { anthropic: { signature: 'sig' } } },
    ])
    const snapshot = JSON.parse(JSON.stringify(prompt)) as typeof prompt

    await callWithHistory({ recorder, reasoning: [], prompt })

    expect(prompt).toEqual(snapshot)
  })

  it('replays signed reasoning as a thinking block, keeping it ahead of the answer text', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        {
          type: 'reasoning',
          text: 'the plan',
          providerOptions: { anthropic: { signature: 'sig-abc' } },
        },
        { type: 'text', text: 'the answer' },
      ],
    })

    const [first] = assistantMessages(recorder, 0)
    expect(first?.content[0]).toEqual({ type: 'thinking', thinking: 'the plan', signature: 'sig-abc' })
    expect(first?.content[1]?.type).toBe('text')
    expect(warnings).toEqual([])
  })

  it('replays redacted thinking as a redacted_thinking block', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        {
          type: 'reasoning',
          text: '',
          providerOptions: { anthropic: { redactedData: 'redacted-blob' } },
        },
        { type: 'text', text: 'the answer' },
      ],
    })

    const [first] = assistantMessages(recorder, 0)
    expect(first?.content[0]).toEqual({ type: 'redacted_thinking', data: 'redacted-blob' })
    expect(warnings).toEqual([])
  })

  it('migrates a legacy providerMetadata signature into providerOptions before replay', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    const legacy = {
      type: 'reasoning',
      text: 'the plan',
      providerMetadata: { anthropic: { signature: 'sig-legacy' } },
    } as unknown as AssistantContent[number]

    await callWithHistory({
      recorder,
      reasoning: [legacy, { type: 'text', text: 'the answer' }],
    })

    const [first] = assistantMessages(recorder, 0)
    expect(first?.content[0]).toEqual({
      type: 'thinking',
      thinking: 'the plan',
      signature: 'sig-legacy',
    })
    expect(warnings).toEqual([])
  })

  it('applies on the subscription path too', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: generatedText('done'), contentType: 'application/json' })

    await callWithHistory({
      recorder,
      credentials: subscriptionCredentials(),
      reasoning: [{ type: 'reasoning', text: 'unsigned' }],
    })

    expect(thinkingBlocks(recorder, 0)).toEqual([])
    expect(warnings).toHaveLength(1)
  })
})
