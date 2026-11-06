import { describe, expect, it } from 'bun:test'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

import type { Assembled, MediaRef } from '@dltech/atlas-core'

import type { MediaUrlSource } from '../../media/media-urls'
import { AiSdkModelPort } from '../ai-sdk-model-port'

const media: MediaRef = {
  hash: 'd'.repeat(64),
  mediaType: 'image/png',
  size: 10,
  width: 4,
  height: 4,
}

const assembled: Assembled = {
  system: [],
  messages: [
    {
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in the picture?' },
          { type: 'media', media },
        ],
      },
      origin: { sessionId: 's', seq: 1 } as never,
    },
  ],
}

const PARTS: LanguageModelV4StreamPart[] = [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: 'a cat' },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  },
]

const recordingModel = () => {
  const model = new MockLanguageModelV4({
    supportedUrls: { 'image/*': [/^https:\/\//] },
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          for (const part of PARTS) controller.enqueue(part)
          controller.close()
        },
      }),
    }),
  })
  return model
}

const run = async (mediaUrls?: MediaUrlSource) => {
  const model = recordingModel()
  const port = new AiSdkModelPort({
    model,
    identity: { id: 'mock', modelId: 'mock-model' },
    mediaUrls,
  })
  await port.step({
    assembled,
    tools: [],
    signal: new AbortController().signal,
  })
  const prompt = model.doStreamCalls[0]?.prompt ?? []
  return prompt.flatMap((message) => (message.role === 'user' ? message.content : []))
}

describe('AiSdkModelPort media urls', () => {
  it('hands the model a url file part for a media part', async () => {
    const asked: string[][] = []
    const source: MediaUrlSource = {
      urlsFor: async (hashes) => {
        asked.push([...hashes])
        return new Map([[media.hash, 'https://blob.fake/d?sig=1']])
      },
      missingOf: async () => [],
    }

    const content = await run(source)

    expect(asked).toEqual([[media.hash]])
    const file = content.find((part) => part.type === 'file')
    expect(file).toMatchObject({ type: 'file', mediaType: 'image/png' })
    const data = file?.type === 'file' ? file.data : undefined
    expect(data).toMatchObject({ type: 'url' })
    expect(String((data as { url: URL }).url)).toBe('https://blob.fake/d?sig=1')
  })

  it('falls back to the text line without a source', async () => {
    const content = await run(undefined)

    expect(content.some((part) => part.type === 'file')).toBe(false)
    expect(content).toContainEqual({
      type: 'text',
      text: `[image ${'d'.repeat(64)} · 4×4]`,
    })
  })
})
