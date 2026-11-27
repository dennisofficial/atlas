import { EQualityTransition, type QualityAssessment, type QualityScope } from '@dltech/atlas-core'

import { SRP_TITLE } from './identity'
import { SRP_DEFINITION } from './text'

const confidenceOf = (assessment: QualityAssessment): string => {
  const concern = assessment.currentConcernProbability
  return concern !== null ? ` (concern ${Math.round(concern * 100)}%)` : ''
}

const debtGuidance = ({
  assessment,
  scope,
}: {
  assessment: QualityAssessment
  scope: QualityScope
}): string =>
  `The file was written successfully. "${SRP_TITLE}" notes that ${scope.kind} ${scope.name} already mixes independently changing responsibilities${confidenceOf(assessment)}. Your edit did not cause this. If this task is a good moment, consider splitting it; otherwise leave it and continue.`

export function guidance({
  assessment,
  scope,
}: {
  assessment: QualityAssessment
  scope: QualityScope
}): string {
  if (assessment.transition === EQualityTransition.TrackDebt)
    return debtGuidance({ assessment, scope })
  const labels = scope.evidence
    .filter((evidence) => assessment.evidenceIds.includes(evidence.id))
    .map((evidence) => evidence.label)
  return [
    `The file was written successfully. "${SRP_TITLE}" suggests that ${scope.kind} ${scope.name} may now mix independently changing responsibilities${confidenceOf(assessment)}.`,
    `Policy: ${SRP_DEFINITION}`,
    ...(labels.length > 0 ? [`Most directly related: ${labels.join(', ')}.`] : []),
    'Consider reviewing where that behavior belongs. If the current structure is justified, leaving the implementation unchanged is fine.',
  ].join('\n')
}
