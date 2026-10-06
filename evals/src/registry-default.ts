import { JEV_QUALITY_MODEL } from '@dltech/atlas-core'

import { createFeatureRegistry } from './feature-registry'
import { createCodeQualityFeature } from '../code-quality/feature'
import { runCodeQualityTask } from '../code-quality/task'
import { createDecisionCaller } from '../code-quality/transport'
import { resolveEvalPolicies } from '../code-quality/policies'
import { fakeSystemOne } from '../__fixtures__/fake-transport'

const defaultRunner = async ({ input, model, deadlineMs }: {
  input: Parameters<typeof runCodeQualityTask>[0]['input']
  model: string
  deadlineMs: number
}) => {
  const decide = createDecisionCaller({ mode: 'fake', fakeSystemOne })
  return runCodeQualityTask({ input, model, deadlineMs, deps: { decide, resolvePolicies: resolveEvalPolicies, defaultModel: JEV_QUALITY_MODEL } })
}

export const codeQualityFeature = createCodeQualityFeature({ runner: defaultRunner })

export const registry = createFeatureRegistry({ features: [codeQualityFeature] })
