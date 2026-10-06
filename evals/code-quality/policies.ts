import { createQualityRegistry, type QualityPolicy } from '@dltech/atlas-core'

import { fakeSrpPolicy } from '../__fixtures__/fake-srp-policy'

const evalQualityRegistry = createQualityRegistry({ policies: [fakeSrpPolicy] })

export function resolveEvalPolicies({ policyIds }: { policyIds: readonly string[] }): readonly QualityPolicy[] {
  return policyIds.map((id) => {
    const policy = evalQualityRegistry.get({ id })
    if (policy === undefined) throw new Error(`no registered eval policy for id "${id}"`)
    return policy
  })
}

export const enabledEvalPolicyIds: readonly string[] = [fakeSrpPolicy.id]
