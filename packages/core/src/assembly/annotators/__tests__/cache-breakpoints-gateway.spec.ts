import { describe, expect, it } from 'bun:test'

import { toEventId } from '../../../events/ids'
import type { ProviderOptions } from '../../../provider'
import type { Assembled } from '../../assembled'
import type { RuleContext } from '../../rule'
import { contextFor } from '../../__tests__/log-fixture'
import { ANTHROPIC_PROVIDER_ID, cacheBreakpoints } from '../cache-breakpoints'
import { GATEWAY_PROVIDER_ID } from '../provider-ids'

const contextOn = (modelId: string): RuleContext => ({
  ...contextFor({ events: [] }),
  provider: { id: GATEWAY_PROVIDER_ID, modelId },
})

const assembled = (): Assembled => ({
  system: [{ text: 'system' }],
  messages: Array.from({ length: 4 }, (_unused, index) => ({
    message: { role: 'user' as const, content: [{ type: 'text' as const, text: `turn ${index}` }] },
    origin: { eventId: toEventId(`event-${index}`), seq: index },
  })),
})

const cacheControlOf = (options: ProviderOptions | undefined): unknown =>
  options?.[ANTHROPIC_PROVIDER_ID]?.cacheControl

const markedAnywhere = (input: Assembled): boolean =>
  input.system.some((block) => cacheControlOf(block.providerOptions) !== undefined) ||
  input.messages.some((entry) =>
    entry.message.content.some((part) => cacheControlOf(part.providerOptions) !== undefined),
  )

describe('cache breakpoints on a gateway route', () => {
  it('places anthropic markers when the routed model speaks anthropic caching', () => {
    const marked = cacheBreakpoints()(assembled(), [], contextOn('anthropic/claude-opus-5-5'))

    expect(markedAnywhere(marked)).toBe(true)
  })

  it('leaves a model that caches implicitly alone', () => {
    const input = assembled()
    const marked = cacheBreakpoints()(
      input,
      [],
      contextOn('deepseek/deepseek-v4.1-flash-1017-fast'),
    )

    expect(marked).toBe(input)
  })
})
