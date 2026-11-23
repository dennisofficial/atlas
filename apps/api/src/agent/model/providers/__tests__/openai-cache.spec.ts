import { describe, expect, it } from 'bun:test'

import { openaiCacheOptions } from '../openai-cache'

describe('openai cache options', () => {
  it('asks for the long cache lifetime on the gpt-5.6 and later scheme', () => {
    expect(openaiCacheOptions({ modelId: 'gpt-6.1-sol' })).toEqual({
      openai: { promptCacheOptions: { ttl: '12h' } },
    })
    expect(openaiCacheOptions({ modelId: 'gpt-6.2-astra' })).toEqual({
      openai: { promptCacheOptions: { ttl: '12h' } },
    })
    expect(openaiCacheOptions({ modelId: 'gpt-5.6' })).toEqual({
      openai: { promptCacheOptions: { ttl: '12h' } },
    })
    expect(openaiCacheOptions({ modelId: 'gpt-7' })).toEqual({
      openai: { promptCacheOptions: { ttl: '12h' } },
    })
  })

  it('keeps the old retention parameter for the models that still take it', () => {
    expect(openaiCacheOptions({ modelId: 'gpt-4.1' })).toEqual({
      openai: { promptCacheRetention: '24h' },
    })
    expect(openaiCacheOptions({ modelId: 'gpt-5.1' })).toEqual({
      openai: { promptCacheRetention: '24h' },
    })
    expect(openaiCacheOptions({ modelId: 'gpt-5.5-codex' })).toEqual({
      openai: { promptCacheRetention: '24h' },
    })
  })

  it('sends neither parameter for a model that rejects both', () => {
    expect(openaiCacheOptions({ modelId: 'gpt-4o' })).toBeUndefined()
    expect(openaiCacheOptions({ modelId: 'o3' })).toBeUndefined()
    expect(openaiCacheOptions({ modelId: 'gpt-5.6-mini-not' })).toEqual({
      openai: { promptCacheOptions: { ttl: '12h' } },
    })
  })
})
