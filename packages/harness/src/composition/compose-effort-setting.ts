import {
  ATLAS_SETTINGS,
  EFFORT_OPTIONS,
  ESettingId,
  ESettingKind,
  parseRef,
  supportedEfforts,
  textValueOf,
  type ChoiceDefinition,
  type SettingOption,
  type SettingsResolution,
} from '@dltech/atlas-core'

import type { ModelCatalogue } from './model-catalogue'

const staticChoice = (id: ESettingId): ChoiceDefinition => {
  const held = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (held === undefined || held.kind !== ESettingKind.Choice) {
    throw new Error(`the registry no longer holds ${id} as a choice to build from`)
  }
  return held
}

const rungOptions = (rungs: readonly string[]): readonly SettingOption[] =>
  rungs.map((rung) => ({ value: rung, label: rung }))

const rungsOfModel = (args: {
  models: ModelCatalogue
  modelId: string
}): readonly SettingOption[] | undefined => {
  const ref = parseRef(args.modelId)
  if (ref === undefined) return undefined
  const rungs = supportedEfforts(args.models.cardFor(ref)?.effort)
  return rungs.length === 0 ? undefined : rungOptions(rungs)
}

/**
 * The effort row a catalogue-aware session registers instead of the static one: the rungs the model
 * that will actually run takes, or the full ladder when that model is unset, unknown, or carries no
 * effort map. The stored value is never rewritten here — an out-of-rungs value self-corrects on the
 * first keypress, and the session clamps when it actually runs the model.
 */
const catalogueAware = (args: {
  base: ChoiceDefinition
  models: ModelCatalogue
  modelIds: (resolution: SettingsResolution) => readonly string[]
}): ChoiceDefinition => ({
  ...args.base,
  optionsFor: ({ resolution }) => {
    for (const modelId of args.modelIds(resolution)) {
      if (modelId.length === 0) continue
      return rungsOfModel({ models: args.models, modelId }) ?? EFFORT_OPTIONS
    }
    return EFFORT_OPTIONS
  },
})

export function effortSettingDefinition(args: { models: ModelCatalogue }): ChoiceDefinition {
  return catalogueAware({
    base: staticChoice(ESettingId.ModelEffort),
    models: args.models,
    modelIds: (resolution) => [textValueOf({ resolution, id: ESettingId.ModelId })],
  })
}

const ownThenMain =
  (own: ESettingId) =>
  (resolution: SettingsResolution): readonly string[] => [
    textValueOf({ resolution, id: own }),
    textValueOf({ resolution, id: ESettingId.ModelId }),
  ]

export function subagentEffortSettingDefinition(args: {
  models: ModelCatalogue
}): ChoiceDefinition {
  return catalogueAware({
    base: staticChoice(ESettingId.SubagentEffort),
    models: args.models,
    modelIds: ownThenMain(ESettingId.SubagentModel),
  })
}

export function quickEffortSettingDefinition(args: { models: ModelCatalogue }): ChoiceDefinition {
  return catalogueAware({
    base: staticChoice(ESettingId.QuickEffort),
    models: args.models,
    modelIds: ownThenMain(ESettingId.QuickModel),
  })
}

export function compactionEffortSettingDefinition(args: {
  models: ModelCatalogue
}): ChoiceDefinition {
  return catalogueAware({
    base: staticChoice(ESettingId.CompactionEffort),
    models: args.models,
    modelIds: ownThenMain(ESettingId.CompactionModel),
  })
}
