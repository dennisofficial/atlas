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
} from '@dltech/atlas-core'

import type { ModelCatalogue } from './model-catalogue'

const staticEffort = (): ChoiceDefinition => {
  const held = ATLAS_SETTINGS.find((definition) => definition.id === ESettingId.ModelEffort)
  if (held === undefined || held.kind !== ESettingKind.Choice) {
    throw new Error('the registry no longer holds a model.effort choice to build from')
  }
  return held
}

const rungOptions = (rungs: readonly string[]): readonly SettingOption[] =>
  rungs.map((rung) => ({ value: rung, label: rung }))

/**
 * The effort row a catalogue-aware session registers instead of the static one: the rungs the
 * resolved default model takes, or the full ladder when the model is unset, unknown, or carries
 * no effort map. The stored value is never rewritten here — an out-of-rungs value self-corrects
 * on the first keypress, and the session clamps when it actually runs the model.
 */
export function effortSettingDefinition(args: { models: ModelCatalogue }): ChoiceDefinition {
  const { models } = args
  const base = staticEffort()

  return {
    id: base.id,
    page: base.page,
    group: base.group,
    label: base.label,
    description: base.description,
    ...(base.environmentVariable === undefined
      ? {}
      : { environmentVariable: base.environmentVariable }),
    ...(base.writeLayer === undefined ? {} : { writeLayer: base.writeLayer }),
    ...(base.storage === undefined ? {} : { storage: base.storage }),
    ...(base.visibleWhen === undefined ? {} : { visibleWhen: base.visibleWhen }),
    kind: base.kind,
    fallback: base.fallback,
    options: base.options,
    optionsFor: ({ resolution }) => {
      const reference = textValueOf({ resolution, id: ESettingId.ModelId })
      const ref = parseRef(reference)
      if (ref === undefined) return EFFORT_OPTIONS

      const rungs = supportedEfforts(models.cardFor(ref)?.effort)
      return rungs.length === 0 ? EFFORT_OPTIONS : rungOptions(rungs)
    },
  }
}
