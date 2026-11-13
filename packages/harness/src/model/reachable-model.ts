import type { LanguageModelV4 } from '@ai-sdk/provider'

/**
 * A provider's account can leave mid-session, so the check runs per call rather than at build time:
 * connecting the provider again fixes the very next turn without a restart.
 */
export function reachableModel(args: {
  model: LanguageModelV4
  fault: () => Error | undefined
}): LanguageModelV4 {
  const guard = (): void => {
    const fault = args.fault()
    if (fault !== undefined) throw fault
  }

  return {
    specificationVersion: 'v4',
    get provider() {
      return args.model.provider
    },
    get modelId() {
      return args.model.modelId
    },
    get supportedUrls() {
      return args.model.supportedUrls
    },
    doGenerate: async (options) => {
      guard()
      return args.model.doGenerate(options)
    },
    doStream: async (options) => {
      guard()
      return args.model.doStream(options)
    },
  }
}
