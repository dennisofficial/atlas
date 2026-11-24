import type { QualityPolicy } from '@dltech/atlas-core'
import {
  createQualityRegistry,
  singleResponsibilityPolicy,
} from '@dltech/atlas-plugin-quality/review'

const evalQualityRegistry = createQualityRegistry({ policies: [singleResponsibilityPolicy] })

export function resolveEvalPolicies({
  policyIds,
}: {
  policyIds: readonly string[]
}): readonly QualityPolicy[] {
  return policyIds.map((id) => {
    const policy = evalQualityRegistry.get({ id })
    if (policy === undefined) throw new Error(`no registered eval policy for id "${id}"`)
    return policy
  })
}

export const enabledEvalPolicyIds: readonly string[] = [singleResponsibilityPolicy.id]
