import type { Assembled } from '../assembled'
import { defineAnnotator, type Annotator } from '../rule'

export const OPENAI_PROVIDER_ID = 'openai'

// The codex backend answers prompt_cache_retention and prompt_cache_options with a 400, but it
// does accept prompt_cache_key — the parameter codex_cli_rs pins to its session id (verified live
// 2026-09-10). Keying it by thread keeps one conversation's prefix lookups on one affinity group.
export function requestCacheKey({ providerId = OPENAI_PROVIDER_ID }: { providerId?: string } = {}): Annotator {
  return defineAnnotator({
    name: 'requestCacheKey',
    apply: (input, _trace, ctx): Assembled => {
      if (ctx.provider.id !== providerId) return input

      return {
        ...input,
        requestOptions: {
          ...input.requestOptions,
          [providerId]: { ...input.requestOptions?.[providerId], promptCacheKey: String(ctx.threadId) },
        },
      }
    },
  })
}
