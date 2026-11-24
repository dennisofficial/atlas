import type { QualityAssessment, QualityScope } from '@dltech/atlas-core'

import { SRP_TITLE } from './identity'
import { SRP_DEFINITION } from './text'

export function guidance({
  assessment,
  scope,
}: {
  assessment: QualityAssessment
  scope: QualityScope
}): string {
  const labels = scope.evidence
    .filter((evidence) => assessment.evidenceIds.includes(evidence.id))
    .map((evidence) => evidence.label)
  const concern = assessment.currentConcernProbability
  const confidence = concern !== null ? ` (concern ${Math.round(concern * 100)}%)` : ''
  return [
    `The file was written successfully. "${SRP_TITLE}" suggests that ${scope.kind} ${scope.name} may now mix independently changing responsibilities${confidence}.`,
    `Policy: ${SRP_DEFINITION}`,
    ...(labels.length > 0 ? [`Most directly related: ${labels.join(', ')}.`] : []),
    'Consider reviewing where that behavior belongs. If the current structure is justified, leaving the implementation unchanged is fine.',
  ].join('\n')
}
