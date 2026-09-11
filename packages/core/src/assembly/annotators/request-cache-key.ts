import type { Assembled } from '../assembled'
import { defineAnnotator, type Annotator } from '../rule'

export const OPENAI_PROVIDER_ID = 'openai'
export const INFERENCE_PROVIDER_ID = 'inference'

// The codex backend answers prompt_cache_retention and prompt_cache_options with a 400, but it
// does accept prompt_cache_key — the parameter codex_cli_rs pins to its session id (verified live
// 2026-09-10). Keying it by thread keeps one conversation's prefix lookups on one affinity group.
//
// @ai-sdk/openai parses `promptCacheKey` out of provider options, so the openai annotator keeps
// the camelCase key. @ai-sdk/openai-compatible instead spreads unknown provider options into the
// request body verbatim, so the inference annotator must spell it `prompt_cache_key` — verified
// live 2026-09-11: with the key, agent-loop probes hit 99% cache reads; without it, 0%.
export function requestCacheKey({
  providerId = OPENAI_PROVIDER_ID,
  optionKey = 'promptCacheKey',
}: { providerId?: string; optionKey?: string } = {}): Annotator {
  return defineAnnotator({
    name: `requestCacheKey:${providerId}`,
    apply: (input, _trace, ctx): Assembled => {
      if (ctx.provider.id !== providerId) return input

      return {
        ...input,
        requestOptions: {
          ...input.requestOptions,
          [providerId]: { ...input.requestOptions?.[providerId], [optionKey]: String(ctx.threadId) },
        },
      }
    },
  })
}
