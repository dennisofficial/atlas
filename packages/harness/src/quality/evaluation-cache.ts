import type { QualityAssessment, QualityDecisionRequest, QualityPolicy, QualityScope } from '@dltech/atlas-core'

const MAX_ENTRIES = 256

export type QualityAssessmentCache = {
  get(args: { key: string }): readonly QualityAssessment[] | undefined
  set(args: { key: string; assessments: readonly QualityAssessment[] }): void
}

export function buildAssessmentCacheKey({
  scope,
  policies,
  request,
  requestedModel,
}: {
  scope: QualityScope
  policies: readonly QualityPolicy[]
  request: QualityDecisionRequest
  requestedModel: string
}): string {
  return JSON.stringify([
    scope.id,
    scope.beforeHash,
    scope.afterHash,
    scope.kind,
    scope.adapterVersion,
    policies.map((policy) => `${policy.id}:${policy.version}`).sort(),
    request.state,
    request.questions,
    requestedModel,
  ])
}

export function createQualityAssessmentCache(): QualityAssessmentCache {
  const entries = new Map<string, readonly QualityAssessment[]>()

  return {
    get: ({ key }) => entries.get(key),
    set: ({ key, assessments }) => {
      entries.delete(key)
      entries.set(key, assessments)
      const oldest = entries.keys().next()
      if (entries.size > MAX_ENTRIES && !oldest.done) entries.delete(oldest.value)
    },
  }
}
