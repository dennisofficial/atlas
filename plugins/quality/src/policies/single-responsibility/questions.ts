import type { DecisionQuestion, QualityScope } from '@dltech/atlas-core'

import {
  FOCUS_NONE,
  FOCUS_UNCERTAIN,
  QUESTION_CONCERN,
  QUESTION_FOCUS,
  QUESTION_IMPACT,
} from './keys'
import { IMPACT_CRITERIA, instructionsFor } from './text'

export function questions({ scope }: { scope: QualityScope }): Record<string, DecisionQuestion> {
  const focusCriteria: Record<string, string> = {}
  for (const candidate of scope.evidence) focusCriteria[candidate.id] = candidate.label
  focusCriteria[FOCUS_NONE] =
    'No supplied candidate most directly supports a new or worsened concern.'
  focusCriteria[FOCUS_UNCERTAIN] = 'The supplied candidates do not allow a confident choice.'

  return {
    [QUESTION_CONCERN]: {
      type: 'noul',
      instructions: instructionsFor(
        'Does the complete scope.after mix independently changing responsibilities under this policy? ' +
          'To decide, enumerate the distinct reasons this class or function would need to change — e.g., a database schema change, an external API change, a protocol change, a routing/policy change. ' +
          'When scope.before is null (newly created), start from the imports and constructor: what external systems does this class touch? What data formats does it own? What side effects does it perform? Each distinct system, format, or side effect is a potential change reason. ' +
          'If two or more of those reasons are genuinely independent (one can change without forcing a change to the other), the scope mixes responsibilities. ' +
          'A class that merely delegates to collaborators without containing independent logic of its own is not a violation. ' +
          'A class that sequences collaborator calls AND also directly implements a substantial unrelated concern (e.g., persistence schema details, filesystem layout, protocol handling, external-API specifics, credential handling) IS a violation — the orchestration exception does not cover it. ' +
          'Wiring, registration, and configuration functions that only wire collaborators together are not violations, even when they reference multiple subsystems. ' +
          'scope.before and scope.diff are comparison context only and are not the target of this question.',
      ),
    },
    [QUESTION_IMPACT]: {
      type: 'choice',
      instructions: instructionsFor(
        'Compare scope.before, scope.after and the actual scope.diff under this one policy and choose how the edit affected the responsibility mix. ' +
          'When scope.before is null, the scope was newly created by this edit: judge the new code on its own. ' +
          'First enumerate the distinct reasons the new code would need to change. If two or more are genuinely independent, the impact is introduced — not unchanged. ' +
          'Choose unchanged only when the new code is cohesive under this policy. ' +
          'A class that orchestrates collaborators but also owns detailed implementation of an unrelated concern (e.g., persistence schema, filesystem layout, protocol handling) is introduced, not unchanged. ' +
          'A class that only delegates to collaborators without containing independent logic is unchanged. ' +
          'Existing debt alone is not introduced. A fix that leaves debt in place but improves it is not worsened.',
      ),
      criteria: { ...IMPACT_CRITERIA },
    },
    [QUESTION_FOCUS]: {
      type: 'choice',
      instructions: instructionsFor(
        'Which candidate in scope.evidence most directly supports a NEW or WORSENED responsibility concern? ' +
          `Choose only a supplied candidate id, "${FOCUS_NONE}", or "${FOCUS_UNCERTAIN}". ` +
          'When the edit improved, left unchanged or resolved the concern this answer is ignored.',
      ),
      criteria: focusCriteria,
    },
  }
}
