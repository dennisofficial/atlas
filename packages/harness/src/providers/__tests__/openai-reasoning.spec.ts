import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { recordingFetch } from './recording-fetch'
import { streamedResponse } from './responses-stream-fixtures'
import {
  TEXT_RESPONSE,
  callWithHistory,
  historyPrompt,
  inputItems,
  reasoningItems,
  subscriptionCredentials,
} from './openai-reasoning-fixtures'

describe('openai history reasoning compatibility', () => {
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

  it('drops Anthropic-signed reasoning with one concise warning and keeps the rest of the turn', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        {
          type: 'reasoning',
          text: 'reasoning text that must never reach a log',
          providerOptions: { anthropic: { signature: 'sig-abc' } },
        },
        { type: 'text', text: 'here is the answer' },
      ],
    })

    const items = inputItems(recorder, 0)
    expect(reasoningItems(items)).toEqual([])
    expect(
      items.some((item) => item.role === 'assistant' && item.type !== 'reasoning'),
    ).toBe(true)
    expect(items.some((item) => item.type === 'function_call')).toBe(true)
    expect(items.some((item) => item.type === 'function_call_output')).toBe(true)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('atlas: omitted 1 historical reasoning part(s)')
    expect(warnings[0]).toContain("another provider's reasoning format")
    expect(warnings[0]).not.toContain('reasoning text that must never reach a log')
  })

  it('drops bare reasoning with no provider metadata without the SDK flood', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [{ type: 'reasoning', text: 'unattributed thinking' }],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('atlas: omitted 1 historical reasoning part(s)')
  })

  it('drops an assistant message left empty once its only part was reasoning', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [{ type: 'reasoning', text: 'only a thought', providerOptions: {} }],
    })

    const items = inputItems(recorder, 0)
    const assistantMessages = items.filter((item) => item.role === 'assistant')
    expect(assistantMessages).toEqual([])
    expect(items.some((item) => item.type === 'function_call')).toBe(true)
  })

  it('does not mutate the canonical history prompt it was handed', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })
    const prompt = historyPrompt([
      { type: 'reasoning', text: 'ephemeral', providerOptions: { anthropic: { signature: 'sig' } } },
    ])
    const snapshot = JSON.parse(JSON.stringify(prompt)) as typeof prompt

    await callWithHistory({ recorder, reasoning: [], prompt })

    expect(prompt).toEqual(snapshot)
  })

  it('replays reasoning with both itemId and encrypted content, preserving unknown metadata keys', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        {
          type: 'reasoning',
          text: 'summary of the plan',
          providerOptions: { openai: { itemId: 'rs_abc', reasoningEncryptedContent: 'enc_abc', phase: 'final' } },
        },
      ],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([
      { type: 'item_reference', id: 'rs_abc' },
    ])
    expect(warnings).toEqual([])
  })

  it('replays encrypted-only reasoning as a reasoning item with its summary text', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        {
          type: 'reasoning',
          text: 'summary text',
          providerOptions: { openai: { reasoningEncryptedContent: 'enc_only' } },
        },
      ],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([
      { type: 'reasoning', encrypted_content: 'enc_only', summary: [{ type: 'summary_text', text: 'summary text' }] },
    ])
    expect(warnings).toEqual([])
  })

  it('replays an itemId-only part against the store:true api key path as an item reference', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      reasoning: [
        { type: 'reasoning', text: 'stored summary', providerOptions: { openai: { itemId: 'rs_stored' } } },
      ],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([
      { type: 'item_reference', id: 'rs_stored' },
    ])
    expect(warnings).toEqual([])
  })

  it('drops itemId-only reasoning on the store:false subscription path with an actionable warning', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: streamedResponse('done') })

    await callWithHistory({
      recorder,
      credentials: subscriptionCredentials(),
      reasoning: [
        { type: 'reasoning', text: 'stored summary', providerOptions: { openai: { itemId: 'rs_stored' } } },
      ],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('store:false requires')
    expect(warnings[0]).not.toContain('stored summary')
  })

  it('keeps encrypted-only reasoning on the store:false subscription path', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: streamedResponse('done') })

    await callWithHistory({
      recorder,
      credentials: subscriptionCredentials(),
      reasoning: [
        {
          type: 'reasoning',
          text: 'summary text',
          providerOptions: { openai: { reasoningEncryptedContent: 'enc_sub' } },
        },
      ],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([
      { type: 'reasoning', encrypted_content: 'enc_sub', summary: [{ type: 'summary_text', text: 'summary text' }] },
    ])
    expect(warnings).toEqual([])
  })

  it('reads reasoning metadata from the openai namespace even for a custom alias provider', async () => {
    watchWarnings()
    const recorder = recordingFetch({ body: TEXT_RESPONSE, contentType: 'application/json' })

    await callWithHistory({
      recorder,
      providerId: 'myproxy.openai',
      reasoning: [
        {
          type: 'reasoning',
          text: 'summary via alias',
          providerOptions: { openai: { reasoningEncryptedContent: 'enc_alias' } },
        },
      ],
    })

    expect(reasoningItems(inputItems(recorder, 0))).toEqual([
      { type: 'reasoning', encrypted_content: 'enc_alias', summary: [{ type: 'summary_text', text: 'summary via alias' }] },
    ])
    expect(warnings).toEqual([])
  })
})
