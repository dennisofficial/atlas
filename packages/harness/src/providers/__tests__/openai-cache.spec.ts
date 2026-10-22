import { describe, expect, it } from 'bun:test'

import { openaiCacheOptions } from '../openai-cache'

describe('openaiCacheOptions', () => {
  it('asks for 24h retention on the gpt-5 line through 5.5', () => {
    for (const modelId of [
      'gpt-5',
      'gpt-5-mini',
      'gpt-5.1',
      'gpt-5.1-codex',
      'gpt-5.2',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.4-pro',
      'gpt-5.5',
    ]) {
      expect(openaiCacheOptions({ modelId })).toEqual({
        openai: { promptCacheRetention: '24h' },
      })
    }
  })

  it('asks for 24h retention on gpt-4.1', () => {
    expect(openaiCacheOptions({ modelId: 'gpt-4.1' })).toEqual({
      openai: { promptCacheRetention: '24h' },
    })
    expect(openaiCacheOptions({ modelId: 'gpt-4.1-mini' })).toEqual({
      openai: { promptCacheRetention: '24h' },
    })
  })

  it('sends nothing on gpt-5.6, which moved to prompt_cache_options with a write charge', () => {
    expect(openaiCacheOptions({ modelId: 'gpt-5.6' })).toBeUndefined()
    expect(openaiCacheOptions({ modelId: 'gpt-5.6-terra' })).toBeUndefined()
  })

  it('sends nothing on models that accept no retention parameter at all', () => {
    expect(openaiCacheOptions({ modelId: 'gpt-4o' })).toBeUndefined()
    expect(openaiCacheOptions({ modelId: 'o3' })).toBeUndefined()
    expect(openaiCacheOptions({ modelId: 'gpt-6-astra' })).toBeUndefined()
    expect(openaiCacheOptions({ modelId: 'gpt-realtime-2.1' })).toBeUndefined()
  })
})
