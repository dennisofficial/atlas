import type { SharedV4ProviderOptions } from '@ai-sdk/provider'

// Extended-retention support per https://developers.openai.com/api/docs/guides/prompt-caching:
// gpt-4.1 and the gpt-5 line through 5.5 accept prompt_cache_retention "24h"; gpt-5.6 moved to
// prompt_cache_options.ttl ("30m" only) with a 1.25x cache-write charge, and gpt-4o/o-series take
// neither. A model that rejects the parameter fails the whole request, so this is a whitelist
// that errs toward sending nothing.
const GPT_4_1 = /^gpt-4\.1(?=[-.]|$)/
const GPT_5 = /^gpt-5(?=[-.]|$)/
const NEW_CACHE_SCHEME = /^gpt-5\.[6-9]/

export function openaiCacheOptions(args: {
  modelId: string
}): SharedV4ProviderOptions | undefined {
  if (NEW_CACHE_SCHEME.test(args.modelId)) return undefined
  if (!GPT_4_1.test(args.modelId) && !GPT_5.test(args.modelId)) return undefined

  return { openai: { promptCacheRetention: '24h' } }
}
