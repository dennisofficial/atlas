import { looksSecretShaped, namesASecretLiteral, type QualityScope } from '@dltech/atlas-core'
import type { PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'

import type { FlaggedExample } from '../../review/engine'
import { normalizeWorkspacePath } from '../../review/review-scopes'

export const QUALITY_EXAMPLE_FLAGGED = 'quality example flagged'
export const MAX_EXAMPLE_EXCERPT_CHARS = 4000

const excerptOf = ({
  scope,
}: {
  scope: QualityScope
}): { excerpt: string; excerptTruncated: boolean } => {
  const after = scope.after ?? ''
  return after.length > MAX_EXAMPLE_EXCERPT_CHARS
    ? { excerpt: after.slice(0, MAX_EXAMPLE_EXCERPT_CHARS), excerptTruncated: true }
    : { excerpt: after, excerptTruncated: false }
}

export const exampleFlaggedProperties = (args: {
  example: FlaggedExample
  projectDirectory: string
  classifierModel: string
}): Readonly<Record<string, PodAnalyticsValue>> | null => {
  const { record, entry } = args.example
  const { excerpt, excerptTruncated } = excerptOf({ scope: entry.scope })
  if (looksSecretShaped({ path: record.path })) return null
  if (namesASecretLiteral({ text: excerpt })) return null
  return {
    policy_id: entry.policy.id,
    policy_version: entry.assessment.policyVersion,
    status: record.status,
    impact: entry.assessment.impact,
    transition: entry.assessment.transition,
    concern_score: entry.assessment.currentConcernProbability,
    finding_id: entry.finding.id,
    episode: entry.finding.episode,
    path:
      normalizeWorkspacePath({ projectDirectory: args.projectDirectory, path: record.path }) ??
      record.path,
    scope_name: entry.scope.name,
    scope_kind: entry.scope.kind,
    language: entry.scope.language,
    line_start: entry.scope.afterLineRange?.start ?? null,
    line_end: entry.scope.afterLineRange?.end ?? null,
    excerpt,
    excerpt_truncated: excerptTruncated,
    classifier_model: args.classifierModel,
  }
}
