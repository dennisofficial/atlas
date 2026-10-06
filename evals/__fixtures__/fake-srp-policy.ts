import {
  EQualityImpact,
  EQualityReviewStatus,
  EQualityTransition,
  type QualityAssessment,
  type QualityPolicy,
  type QualityScope,
} from '@dltech/atlas-core'

export const FAKE_SRP_POLICY_ID = 'single-responsibility'

const CONCERN_THRESHOLD = 0.8
const RESOLVE_CONCERN_CEILING = 0.2

const IMPACT_OPTIONS = {
  introduced: 'The edit introduces a new single-responsibility concern not present before',
  worsened: 'The edit makes an existing concern materially worse',
  improved: 'The edit reduces the concern but debt remains',
  resolved: 'The edit removes the concern entirely',
  unchanged: 'The concern state is materially unchanged by this edit',
  not_applicable: 'The policy does not apply to this scope',
  uncertain: 'The evidence does not support a confident impact judgment',
}

export const fakeSrpPolicy: QualityPolicy = {
  id: FAKE_SRP_POLICY_ID,
  version: '1',
  title: 'Single Responsibility',
  description: 'A scope should gather behavior that changes for the same reasons',
  settingKey: 'quality.policies.singleResponsibility',
  defaultEnabled: true,
  definition: 'Gather behavior that changes for the same reasons; separate independently changing behavior.',
  exceptions: ['thin delegation or facades', 'orchestration composing responsibilities intentionally'],
  selectScopes: ({ scopes }) =>
    scopes.filter((scope) => scope.kind === 'class' || scope.kind === 'function').map((scope) => scope.id),
  questions: ({ scope }) => ({
    currentConcern: {
      type: 'noul',
      instructions: `Does the complete AFTER scope (state.scope.after) for ${scope.name} mix independently changing responsibilities? state.scope.before is comparison context only.`,
    },
    impact: {
      type: 'choice',
      instructions: `Compare state.scope.before, state.scope.after and state.scope.diff under this policy. Existing debt alone is not introduced.`,
      criteria: IMPACT_OPTIONS,
    },
    focus: {
      type: 'choice',
      instructions: 'Which supplied changed declaration/evidence candidate (state.scope.evidence ids) most directly supports a new or worsened concern? Use none or uncertain when unsupported.',
      criteria: {
        none: 'No candidate supports the concern',
        uncertain: 'Cannot decide among candidates',
        ...Object.fromEntries(scope.evidence.map((entry) => [entry.id, entry.label])),
      },
    },
  }),
  interpret: ({ scope, answers }): QualityAssessment => {
    const base = {
      policyId: FAKE_SRP_POLICY_ID,
      policyVersion: '1',
      scopeId: scope.id,
      rawAnswers: answers,
      evidenceIds: [] as readonly string[],
    }
    const concern = answers.currentConcern?.noul
    const impactChoice = answers.impact?.choice
    if (concern === undefined || impactChoice === undefined || !(impactChoice in IMPACT_OPTIONS)) {
      return {
        ...base,
        status: EQualityReviewStatus.Inconclusive,
        impact: EQualityImpact.Uncertain,
        currentConcernProbability: null,
        transition: EQualityTransition.None,
        detail: 'missing or invalid answers',
      }
    }
    const impact = impactChoice as EQualityImpact
    const focusChoice = answers.focus?.choice
    const focusValid =
      focusChoice !== undefined &&
      focusChoice !== 'none' &&
      focusChoice !== 'uncertain' &&
      (answers.focus?.probabilities?.[focusChoice] ?? 0) >= CONCERN_THRESHOLD
    const evidenceIds = focusValid ? [focusChoice] : []

    const confidentNew =
      concern >= CONCERN_THRESHOLD &&
      (impact === EQualityImpact.Introduced || impact === EQualityImpact.Worsened) &&
      (answers.impact?.probabilities?.[impactChoice] ?? 1) >= CONCERN_THRESHOLD

    const resolves =
      concern <= RESOLVE_CONCERN_CEILING &&
      (impact === EQualityImpact.Resolved || impact === EQualityImpact.Improved || impact === EQualityImpact.Unchanged) &&
      (answers.impact?.probabilities?.[impactChoice] ?? 1) >= CONCERN_THRESHOLD

    const transition = resolves
      ? EQualityTransition.Resolve
      : confidentNew && focusValid
        ? EQualityTransition.Introduce
        : concern >= CONCERN_THRESHOLD
          ? EQualityTransition.TrackDebt
          : EQualityTransition.None

    return {
      ...base,
      status: EQualityReviewStatus.Completed,
      impact,
      currentConcernProbability: concern,
      transition,
      evidenceIds,
    }
  },
  guidance: ({ assessment, scope }) =>
    `Scope ${scope.name} may mix responsibilities (impact ${assessment.impact}). Review placement; leaving it unchanged is acceptable.`,
}
