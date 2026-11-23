import { describe, expect, it } from 'bun:test'

import type { ImageModel, LanguageModel, ModelMessage } from 'ai'

import {
  EGenerateRefusal,
  EGenerateRoute,
  type GenerateSdk,
  type SdkPicture,
  generateWithGateway,
  isZeroDataRetention,
  routeOf,
  zdrImageModelsIn,
  zdrImageModels,
  ZDR_FALLBACK_MODELS,
} from '../generate'

const modelIdOf = (model: ImageModel | LanguageModel): string =>
  typeof model === 'string' ? model : model.modelId

const pictureOf = (): SdkPicture => ({
  uint8Array: new Uint8Array([7, 7, 7]),
  mediaType: 'image/png',
})

type Recorded = {
  route: EGenerateRoute
  model: string
  prompt?: string | { images: Uint8Array[]; text: string }
  messages?: ModelMessage[]
}

const sdkOf = (record: Recorded[]): GenerateSdk => ({
  image: async (args) => {
    record.push({ route: EGenerateRoute.Image, model: modelIdOf(args.model), prompt: args.prompt })
    return { images: [pictureOf()] }
  },
  text: async (args) => {
    record.push({
      route: EGenerateRoute.Text,
      model: modelIdOf(args.model),
      messages: args.messages,
    })
    return { files: [pictureOf()] }
  },
})

const partsOf = (messages: readonly ModelMessage[] | undefined): readonly string[] => {
  const content = messages?.[0]?.content
  if (!Array.isArray(content)) return []
  return content.map((part) => (typeof part === 'object' && 'type' in part ? part.type : 'text'))
}

describe('generateWithGateway', () => {
  it('routes a google model id through the language model, pictures first', async () => {
    const record: Recorded[] = []
    const outcome = await generateWithGateway({
      apiKey: 'vck_test',
      model: 'google/gemini-3.1-flash-image',
      prompt: 'a lighthouse at dusk',
      images: [{ bytes: new Uint8Array([1]), mediaType: 'image/png' }],
      signal: new AbortController().signal,
      sdk: sdkOf(record),
    })

    expect(outcome).toEqual({ ok: true, bytes: new Uint8Array([7, 7, 7]), mediaType: 'image/png' })
    expect(record.map((entry) => entry.route)).toEqual([EGenerateRoute.Text])
    expect(record[0]?.model).toBe('google/gemini-3.1-flash-image')
    expect(partsOf(record[0]?.messages)).toEqual(['file', 'text'])
  })

  it('routes every other model id through the image model with the raw bytes', async () => {
    const record: Recorded[] = []
    await generateWithGateway({
      apiKey: 'vck_test',
      model: 'microsoft/mai-image-2.7',
      prompt: 'a lighthouse at dusk',
      images: [{ bytes: new Uint8Array([1, 2]), mediaType: 'image/png' }],
      signal: new AbortController().signal,
      sdk: sdkOf(record),
    })

    expect(record.map((entry) => entry.route)).toEqual([EGenerateRoute.Image])
    const prompt = record[0]?.prompt
    expect(typeof prompt === 'object' ? prompt.text : prompt).toBe('a lighthouse at dusk')
    expect(typeof prompt === 'object' ? prompt.images.length : 0).toBe(1)
  })

  it('sends the plain prompt when there is no image to edit', async () => {
    const record: Recorded[] = []
    await generateWithGateway({
      apiKey: 'vck_test',
      model: 'microsoft/mai-image-2.7',
      prompt: 'a lighthouse at dusk',
      images: [],
      signal: new AbortController().signal,
      sdk: sdkOf(record),
    })

    expect(record[0]?.prompt).toBe('a lighthouse at dusk')
  })

  it('names a Zero Data Retention refusal as its own refusal, with the gateway message', async () => {
    const outcome = await generateWithGateway({
      apiKey: 'vck_test',
      model: 'openai/gpt-image-2',
      prompt: 'a lighthouse',
      images: [],
      signal: new AbortController().signal,
      sdk: {
        image: async () => {
          throw new Error('refused: zdr_ineligible_model for openai/gpt-image-2')
        },
        text: async () => ({ files: [] }),
      },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? undefined : outcome.refusal).toBe(EGenerateRefusal.ZeroDataRetention)
    expect(outcome.ok ? '' : outcome.reason).toContain('zdr_ineligible_model')
  })

  it('passes any other failure through unchanged', async () => {
    const outcome = await generateWithGateway({
      apiKey: 'vck_test',
      model: 'microsoft/mai-image-2.7',
      prompt: 'a lighthouse',
      images: [],
      signal: new AbortController().signal,
      sdk: {
        image: async () => {
          throw new Error('upstream returned 500')
        },
        text: async () => ({ files: [] }),
      },
    })

    expect(outcome.ok ? undefined : outcome.refusal).toBe(EGenerateRefusal.Failed)
    expect(outcome.ok ? '' : outcome.reason).toBe('upstream returned 500')
  })

  it('refuses when the gateway answers with no image', async () => {
    const outcome = await generateWithGateway({
      apiKey: 'vck_test',
      model: 'microsoft/mai-image-2.7',
      prompt: 'a lighthouse',
      images: [],
      signal: new AbortController().signal,
      sdk: { image: async () => ({ images: [] }), text: async () => ({ files: [] }) },
    })

    expect(outcome.ok ? undefined : outcome.refusal).toBe(EGenerateRefusal.Failed)
    expect(outcome.ok ? '' : outcome.reason).toContain('returned no image')
  })
})

describe('routeOf', () => {
  it('sends google image ids down the language-model path and the rest down the image path', () => {
    expect(routeOf('google/gemini-3.1-flash-image')).toBe(EGenerateRoute.Text)
    expect(routeOf('microsoft/mai-image-2.7')).toBe(EGenerateRoute.Image)
    expect(routeOf('spacexai/grok-imagine-image-2.0')).toBe(EGenerateRoute.Image)
  })
})

describe('isZeroDataRetention', () => {
  it('recognises every wording the gateway uses for it', () => {
    expect(isZeroDataRetention('no_zdr_providers_available')).toBe(true)
    expect(isZeroDataRetention('zdr_ineligible_model')).toBe(true)
    expect(isZeroDataRetention('This model cannot run under Zero Data Retention')).toBe(true)
    expect(isZeroDataRetention('provider returned 500')).toBe(false)
  })
})

describe('zdrImageModelsIn', () => {
  it('keeps the image models the gateway can run under ZDR', () => {
    const models = zdrImageModelsIn({
      data: [
        { id: 'microsoft/mai-image-2.7', type: 'image', zdr: 'all' },
        { id: 'bfl/flux-kontext-pro', type: 'image', zdr: 'none' },
        { id: 'google/gemini-3.1-flash-image', type: 'language', zdr: 'some' },
        { id: 'openai/gpt-5', type: 'language', zdr: 'all' },
        { id: 'spacexai/grok-imagine-image-2.0', type: 'image' },
        { id: 'broken' },
      ],
    })

    expect(models).toEqual(['microsoft/mai-image-2.7', 'google/gemini-3.1-flash-image'])
  })

  it('answers nothing for a payload that is not the model list', () => {
    expect(zdrImageModelsIn({ models: [] })).toEqual([])
    expect(zdrImageModelsIn(null)).toEqual([])
  })
})

const stubFetchOf = (respond: () => Promise<Response>): typeof fetch =>
  Object.assign(respond, { preconnect: () => undefined })

describe('zdrImageModels', () => {
  it('falls back to the known models when the lookup fails', async () => {
    const original = globalThis.fetch
    globalThis.fetch = stubFetchOf(async () => {
      throw new Error('offline')
    })

    try {
      expect(await zdrImageModels(new AbortController().signal)).toEqual(ZDR_FALLBACK_MODELS)
    } finally {
      globalThis.fetch = original
    }
  })

  it('falls back to the known models when the answer names none', async () => {
    const original = globalThis.fetch
    globalThis.fetch = stubFetchOf(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    )

    try {
      expect(await zdrImageModels(new AbortController().signal)).toEqual(ZDR_FALLBACK_MODELS)
    } finally {
      globalThis.fetch = original
    }
  })
})
