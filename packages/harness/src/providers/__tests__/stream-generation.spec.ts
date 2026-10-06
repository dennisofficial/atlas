import { describe, expect, it } from 'bun:test'
import type {
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from '@ai-sdk/provider'

import { generationFromStream, StreamEndedWithoutFinishError } from '../stream-generation'

const USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}

const FINISH: LanguageModelV4StreamPart = {
  type: 'finish',
  usage: USAGE,
  finishReason: { unified: 'stop', raw: undefined },
  providerMetadata: { openai: { responseId: 'resp_1' } },
}

const resultOf = ({
  parts,
  failure,
  extra,
}: {
  parts: readonly LanguageModelV4StreamPart[]
  failure?: Error
  extra?: Omit<LanguageModelV4StreamResult, 'stream'>
}): LanguageModelV4StreamResult => ({
  ...extra,
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      if (failure !== undefined) controller.error(failure)
      else controller.close()
    },
  }),
})

describe('collecting a streamed model response into a generation', () => {
  it('assembles interleaved text and reasoning blocks in first-seen order', async () => {
    const generation = await generationFromStream({
      result: resultOf({
        parts: [
          { type: 'reasoning-start', id: 'r1' },
          { type: 'text-start', id: 't1' },
          { type: 'reasoning-delta', id: 'r1', delta: 'think ' },
          { type: 'text-delta', id: 't1', delta: 'hel' },
          { type: 'reasoning-delta', id: 'r1', delta: 'more' },
          { type: 'text-delta', id: 't1', delta: 'lo' },
          { type: 'text-start', id: 't2' },
          { type: 'text-delta', id: 't2', delta: '!' },
          FINISH,
        ],
      }),
    })

    expect(generation.content).toEqual([
      { type: 'reasoning', text: 'think more' },
      { type: 'text', text: 'hello' },
      { type: 'text', text: '!' },
    ])
  })

  it('merges start and end provider metadata into the block', async () => {
    const generation = await generationFromStream({
      result: resultOf({
        parts: [
          { type: 'reasoning-start', id: 'r1', providerMetadata: { openai: { itemId: 'rs_1' } } },
          { type: 'reasoning-delta', id: 'r1', delta: 'x' },
          {
            type: 'reasoning-end',
            id: 'r1',
            providerMetadata: { openai: { reasoningEncryptedContent: 'enc' } },
          },
          { type: 'text-start', id: 't1', providerMetadata: { openai: { itemId: 'msg_1' } } },
          { type: 'text-delta', id: 't1', delta: 'ok' },
          { type: 'text-end', id: 't1', providerMetadata: { openai: { phase: 'final_answer' } } },
          FINISH,
        ],
      }),
    })

    expect(generation.content).toEqual([
      {
        type: 'reasoning',
        text: 'x',
        providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc' } },
      },
      {
        type: 'text',
        text: 'ok',
        providerMetadata: { openai: { itemId: 'msg_1', phase: 'final_answer' } },
      },
    ])
  })

  it('passes tool, source, file and custom content through and drops tool-input chunks and raw', async () => {
    const toolCall: LanguageModelV4StreamPart = {
      type: 'tool-call',
      toolCallId: 'c1',
      toolName: 'lookup',
      input: '{"city":"paris"}',
    }
    const source: LanguageModelV4StreamPart = {
      type: 'source',
      sourceType: 'url',
      id: 's1',
      url: 'https://example.com',
    }
    const custom: LanguageModelV4StreamPart = { type: 'custom', kind: 'openai.compaction' }

    const generation = await generationFromStream({
      result: resultOf({
        parts: [
          { type: 'tool-input-start', id: 'c1', toolName: 'lookup' },
          { type: 'tool-input-delta', id: 'c1', delta: '{"city"' },
          { type: 'tool-input-end', id: 'c1' },
          { type: 'raw', rawValue: { anything: true } },
          toolCall,
          source,
          custom,
          FINISH,
        ],
      }),
    })

    expect(generation.content).toEqual([toolCall, source, custom])
  })

  it('reports usage, finish reason, provider metadata, warnings, request and response details', async () => {
    const timestamp = new Date('2026-01-01T00:00:00Z')
    const generation = await generationFromStream({
      result: resultOf({
        parts: [
          { type: 'stream-start', warnings: [{ type: 'other', message: 'first' }] },
          { type: 'response-metadata', id: 'resp_1', timestamp },
          { type: 'response-metadata', modelId: 'gpt-5.1-codex' },
          { type: 'stream-start', warnings: [{ type: 'other', message: 'second' }] },
          FINISH,
        ],
        extra: { request: { body: { stream: true } }, response: { headers: { 'x-id': 'abc' } } },
      }),
    })

    expect(generation).toEqual({
      content: [],
      usage: USAGE,
      finishReason: { unified: 'stop', raw: undefined },
      providerMetadata: { openai: { responseId: 'resp_1' } },
      warnings: [
        { type: 'other', message: 'first' },
        { type: 'other', message: 'second' },
      ],
      request: { body: { stream: true } },
      response: {
        id: 'resp_1',
        timestamp,
        modelId: 'gpt-5.1-codex',
        headers: { 'x-id': 'abc' },
      },
    })
  })

  it('rejects with the error an error part carries', async () => {
    const failure = new Error('upstream exploded')

    await expect(
      generationFromStream({
        result: resultOf({
          parts: [{ type: 'text-delta', id: 't1', delta: 'par' }, { type: 'error', error: failure }, FINISH],
        }),
      }),
    ).rejects.toBe(failure)
  })

  it('wraps a non-error value reported by an error part', async () => {
    await expect(
      generationFromStream({
        result: resultOf({ parts: [{ type: 'error', error: { code: 'bad' } }, FINISH] }),
      }),
    ).rejects.toThrow('The model stream reported an error')
  })

  it('rejects when reading the stream throws', async () => {
    const failure = new Error('socket reset')

    await expect(
      generationFromStream({
        result: resultOf({ parts: [{ type: 'text-delta', id: 't1', delta: 'x' }], failure }),
      }),
    ).rejects.toBe(failure)
  })

  it('rejects a stream that closes without finishing rather than returning a partial answer', async () => {
    await expect(
      generationFromStream({
        result: resultOf({ parts: [{ type: 'text-delta', id: 't1', delta: 'partial' }] }),
      }),
    ).rejects.toBeInstanceOf(StreamEndedWithoutFinishError)
  })

  it('releases the stream after a failed collection', async () => {
    const result = resultOf({ parts: [{ type: 'error', error: new Error('boom') }, FINISH] })

    await generationFromStream({ result }).catch(() => undefined)

    expect(result.stream.locked).toBe(false)
  })
})
