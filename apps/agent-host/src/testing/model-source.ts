import { EEffort, EModelRole, type ResolvedModelChoice } from '@dltech/atlas-core'

import type { ModelConfig } from '../config/agent-host-config'
import type { ModelSource } from '../config/model-config'

const UNCONFIGURED_CHOICE: ResolvedModelChoice = {
  ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
  effort: EEffort.Medium,
  fast: false,
  role: EModelRole.Main,
  source: EModelRole.Main,
  follows: undefined,
  stale: false,
}

export const fakeModelSourceOf = (config: ModelConfig): ModelSource => {
  const choice: ResolvedModelChoice =
    config.configured === true
      ? {
          ref: config.ref,
          effort: config.effort,
          fast: config.fast,
          role: EModelRole.Main,
          source: EModelRole.Main,
          follows: undefined,
          stale: false,
        }
      : UNCONFIGURED_CHOICE
  return {
    main: { choice, config },
    resolve: () => ({ choice, config }),
  }
}
