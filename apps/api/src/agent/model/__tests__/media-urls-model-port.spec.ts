import { describe, expect, it } from 'bun:test'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'

import {
  EImageTier,
  MAX_API_EDGE,
  MAX_INLINE_BYTES,
  type Assembled,
  type MediaRef,
  type ModelCard,
} from '@dltech/atlas-core'

import type { MediaSource } from '../../media/media-urls'
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

const cardOf = (image: ModelCard['image']): ModelCard => ({
  ref: { providerId: 'mock', modelId: 'mock-model' },
  label: 'mock',
  api: 'anthropic-messages',
  contextWindow: 200_000,
  imageTier: EImageTier.HighResolution,
  ...(image === undefined ? {} : { image }),
})

const URL_CARD = cardOf({
  images: 'both',
  maxInlineBytes: MAX_INLINE_BYTES,
  maxEdge: MAX_API_EDGE,
})

const INLINE_CARD = cardOf({ images: 'inline', maxInlineBytes: MAX_INLINE_BYTES })

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

const run = async (
  args: { mediaSource?: MediaSource; modelCard?: ModelCard } = {},
): Promise<readonly unknown[]> => {
  const model = recordingModel()
  const port = new AiSdkModelPort({
    model,
    identity: { id: 'mock', modelId: 'mock-model' },
    ...(args.modelCard === undefined ? {} : { card: args.modelCard }),
    ...(args.mediaSource === undefined ? {} : { mediaSource: args.mediaSource }),
  })
  await port.step({
    assembled,
    tools: [],
    signal: new AbortController().signal,
  })
  const prompt = model.doStreamCalls[0]?.prompt ?? []
  return prompt.flatMap((message) => (message.role === 'user' ? message.content : []))
}

const typeOf = (part: unknown): string | undefined => (part as { type?: string }).type

const filePartOf = (content: readonly unknown[]) => content.find((part) => typeOf(part) === 'file')

describe('AiSdkModelPort media delivery', () => {
  it('hands a url-capable model a url file part', async () => {
    const asked: string[][] = []
    const mediaSource: MediaSource = {
      urlsFor: async (hashes) => {
        asked.push([...hashes])
        return new Map([[media.hash, 'https://blob.fake/d?sig=1']])
      },
      bytesFor: async () => new Map(),
      missingOf: async () => [],
    }

    const content = await run({ mediaSource, modelCard: URL_CARD })

    expect(asked).toEqual([[media.hash]])
    expect(filePartOf(content)).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'url' },
    })
  })

  it('inlines the stored bytes for a provider that takes only those', async () => {
    const asked: string[][] = []
    const mediaSource: MediaSource = {
      urlsFor: async () => new Map(),
      bytesFor: async (hashes) => {
        asked.push([...hashes])
        return new Map([[media.hash, 'iVBORw0KGgo=']])
      },
      missingOf: async () => [],
    }

    const content = await run({ mediaSource, modelCard: INLINE_CARD })

    expect(asked).toEqual([[media.hash]])
    expect(filePartOf(content)).toEqual({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'data', data: 'iVBORw0KGgo=' },
    })
  })

  it('names what the store no longer holds instead of inventing a path', async () => {
    const mediaSource: MediaSource = {
      urlsFor: async () => new Map(),
      bytesFor: async () => new Map(),
      missingOf: async () => [],
    }

    const content = await run({ mediaSource, modelCard: INLINE_CARD })

    expect(filePartOf(content)).toBeUndefined()
    expect(content).toContainEqual({
      type: 'text',
      text: `[image unavailable: ${'d'.repeat(64)}]`,
    })
  })

  it('sends no picture and no path without a media source', async () => {
    const content = await run({ modelCard: URL_CARD })

    expect(filePartOf(content)).toBeUndefined()
    expect(content).toContainEqual({
      type: 'text',
      text: `[image unavailable: ${'d'.repeat(64)}]`,
    })
  })
})
