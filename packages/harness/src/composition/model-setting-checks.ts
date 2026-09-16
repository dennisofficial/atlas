import {
  ESettingKind,
  parseRef,
  textValueOf,
  type SettingDefinition,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { isRefReachable, type ModelCatalogue } from './model-catalogue'

export type ModelSettingProblem = {
  id: string
  label: string
  reference: string
  reason: 'unknown-model' | 'provider-not-set-up'
}

/**
 * Every model row whose pick cannot run: either the catalogue never heard of the model, or the
 * provider has no account. Pure config — no call is made. A row left empty is never a problem:
 * empty means follow the default.
 */
export function unreachableModelSettings(args: {
  definitions: readonly SettingDefinition[]
  resolution: SettingsResolution
  catalogue: ModelCatalogue
}): readonly ModelSettingProblem[] {
  const problems: ModelSettingProblem[] = []

  for (const definition of args.definitions) {
    if (definition.kind !== ESettingKind.Model) continue

    const reference = textValueOf({ resolution: args.resolution, id: definition.id })
    if (reference.length === 0) continue

    const ref = parseRef(reference)
    if (ref === undefined || args.catalogue.cardFor(ref) === undefined) {
      problems.push({ id: definition.id, label: definition.label, reference, reason: 'unknown-model' })
      continue
    }

    if (!isRefReachable({ catalogue: args.catalogue, ref })) {
      problems.push({
        id: definition.id,
        label: definition.label,
        reference,
        reason: 'provider-not-set-up',
      })
    }
  }

  return problems
}

export const modelSettingProblemText = (problem: ModelSettingProblem): string =>
  problem.reason === 'unknown-model'
    ? `${problem.label} is set to ${problem.reference}, which no provider carries — it follows the default model until you pick again in settings › models.`
    : `${problem.label} is set to ${problem.reference}, but that provider has no account set up — it follows the default model until you pick again in settings › models.`
