import { APICallError, type LanguageModelV4 } from '@ai-sdk/provider'

import { causeChainOf } from '@dltech/atlas-agent'

// Fast mode has its own rate limit and, on a Claude plan, bills usage credits only, so a 429/529 or
// a credits refusal on a fast request says nothing about standard speed. Claude Code retries such a
// request at standard speed and turns fast mode off: https://code.claude.com/docs/en/fast-mode
const FAST_REFUSAL_STATUSES: ReadonlySet<number> = new Set([429, 529])
const FAST_REFUSAL_TEXT = /fast mode|usage credits|extra usage/i

export const isFastRefusal = (error: unknown): boolean =>
  causeChainOf(error).some(
    (link) =>
      APICallError.isInstance(link) &&
      (FAST_REFUSAL_STATUSES.has(link.statusCode ?? 0) ||
        FAST_REFUSAL_TEXT.test(`${link.message} ${link.responseBody ?? ''}`)),
  )

export function withFastFallback(args: {
  build: (fast: boolean) => LanguageModelV4
  requested: () => boolean
}): LanguageModelV4 {
  const fast = args.build(true)
  const standard = args.build(false)

  const attempt = async <TResult>(
    call: (model: LanguageModelV4) => PromiseLike<TResult>,
  ): Promise<TResult> => {
    if (!args.requested()) return call(standard)
    try {
      return await call(fast)
    } catch (error) {
      if (!isFastRefusal(error)) throw error
      return call(standard)
    }
  }

  return {
    specificationVersion: 'v4',
    provider: standard.provider,
    modelId: standard.modelId,
    supportedUrls: standard.supportedUrls,
    doGenerate: (options) => attempt((model) => model.doGenerate(options)),
    doStream: (options) => attempt((model) => model.doStream(options)),
  }
}
