import { describe, expect, it } from 'bun:test'

import type { Assembled } from '../../assembled'
import type { RuleContext } from '../../rule'
import { contextFor } from '../../__tests__/log-fixture'
import { cacheBreakpoints } from '../cache-breakpoints'
import { OPENAI_PROVIDER_ID, requestCacheKey } from '../request-cache-key'

const BARE: Assembled = { system: [], messages: [] }

const contextOn = (providerId: string): RuleContext => ({
  ...contextFor({ events: [] }),
  provider: { id: providerId, modelId: 'a-model' },
})

describe('requestCacheKey', () => {
  it('pins the thread id as the openai prompt cache key', () => {
    const ctx = contextOn(OPENAI_PROVIDER_ID)
    const result = requestCacheKey()(BARE, [], ctx)

    expect(result.requestOptions).toEqual({
      openai: { promptCacheKey: String(ctx.threadId) },
    })
  })

  it('leaves other providers untouched', () => {
    const result = requestCacheKey()(BARE, [], contextOn('anthropic'))

    expect(result.requestOptions).toBeUndefined()
  })

  it('survives the cache-breakpoint annotator running ahead of it', () => {
    const ctx = contextOn(OPENAI_PROVIDER_ID)
    const keyed = requestCacheKey()(BARE, [], ctx)
    const annotated = cacheBreakpoints()(keyed, [], ctx)

    expect(annotated.requestOptions).toEqual(keyed.requestOptions)
  })
})
