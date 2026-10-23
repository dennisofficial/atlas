import { EEffort, EFFORT_LADDER, type ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import { AUTO_MODEL_ID } from './model-options'

export type ModelSelection = { id: string; effort: EEffort }

export const DEFAULT_EFFORT = EEffort.Medium

export const AUTO_SELECTION: ModelSelection = { id: AUTO_MODEL_ID, effort: DEFAULT_EFFORT }

export const effortOfName = (name: string | undefined): EEffort =>
  EFFORT_LADDER.find((effort) => effort === name) ?? DEFAULT_EFFORT

export function createFieldsOf(selection: ModelSelection): { model?: string; effort?: string } {
  if (selection.id === AUTO_MODEL_ID) return {}
  return { model: selection.id, effort: selection.effort }
}

function clampedEffort({
  offered,
  effort,
}: {
  offered: readonly EEffort[] | undefined
  effort: EEffort
}): EEffort {
  if (offered === undefined || offered.length === 0 || offered.includes(effort)) return effort
  const asked = EFFORT_LADDER.indexOf(effort)
  const above = offered.find((candidate) => EFFORT_LADDER.indexOf(candidate) > asked)
  return above ?? offered[offered.length - 1] ?? effort
}

export function selectionAfterPick(args: {
  models: readonly ModelOption[]
  id: string
  effort: EEffort
}): ModelSelection {
  const picked = args.models.find((model) => model.id === args.id)
  return { id: args.id, effort: clampedEffort({ offered: picked?.efforts, effort: args.effort }) }
}

export function defaultSelectionOf(args: {
  models: readonly ModelOption[]
  personalId: string
  personalEffort: string
}): ModelSelection {
  const offered = args.models.some((model) => model.id === args.personalId && model.auto !== true)
  if (!offered) return AUTO_SELECTION
  return selectionAfterPick({
    models: args.models,
    id: args.personalId,
    effort: effortOfName(args.personalEffort),
  })
}

export function existingSelectionOf(
  model: { ref: string; effort: string } | undefined,
): ModelSelection {
  if (model === undefined) return AUTO_SELECTION
  return { id: model.ref, effort: effortOfName(model.effort) }
}
