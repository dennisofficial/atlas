import { outputPriceLabel } from '@dltech/atlas-core'
import type { ModelsResponse } from '@dltech/atlas-wire/web'

export const EFFORT_LADDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const DEFAULT_EFFORT = 'medium'

export const NO_MODEL_LABEL = 'Default'

const CLAUDE_PREFIX = 'Claude '

const EFFORT_LABELS: Record<string, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

export const effortLabelOf = (name: string): string =>
  EFFORT_LABELS[name] ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`

export interface IModelOption {
  id: string
  label: string
  provider: string
  providerId: string
  monogram: string
  efforts: readonly string[]
  context: string
  rate: string | null
  fast: boolean
}

export interface IModelSelection {
  model: IModelOption
  effort: string
  fast: boolean
}

export interface IModelGroup {
  providerId: string
  provider: string
  models: readonly IModelOption[]
}

const labelOf = (label: string): string =>
  label.startsWith(CLAUDE_PREFIX) ? label.slice(CLAUDE_PREFIX.length) : label

const contextLabelOf = (tokens: number): string =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1_000)}k`

const rateOf = (model: {
  inputPerMillion?: number | undefined
  outputPerMillion?: number | undefined
}): string | null => {
  if (model.inputPerMillion === undefined || model.outputPerMillion === undefined) return null
  return (
    outputPriceLabel({
      inputPerMillion: model.inputPerMillion,
      outputPerMillion: model.outputPerMillion,
    }) ?? null
  )
}

export const modelOptionsOf = (response: ModelsResponse): IModelOption[] =>
  response.providers
    .filter((provider) => provider.status === 'connected')
    .flatMap((provider) =>
      provider.models.map((model) => ({
        id: model.id,
        label: labelOf(model.label),
        provider: provider.label,
        providerId: provider.id,
        monogram: provider.label.charAt(0).toUpperCase(),
        efforts: model.efforts,
        context: contextLabelOf(model.contextWindow),
        rate: rateOf(model),
        fast: model.fast === true,
      })),
    )

export const modelGroupsOf = (models: readonly IModelOption[]): readonly IModelGroup[] => {
  const held = new Map<string, IModelOption[]>()
  for (const model of models) {
    const group = held.get(model.providerId)
    if (group === undefined) held.set(model.providerId, [model])
    else group.push(model)
  }
  return [...held].map(([providerId, group]) => ({
    providerId,
    provider: group[0]?.provider ?? providerId,
    models: group,
  }))
}

export const pinnedModelsOf = ({
  models,
  pinned,
}: {
  models: readonly IModelOption[]
  pinned: readonly string[]
}): readonly IModelOption[] => {
  const byId = new Map(models.map((model) => [model.id, model]))
  return pinned.flatMap((id) => {
    const model = byId.get(id)
    return model === undefined ? [] : [model]
  })
}

export const withoutPinned = ({
  models,
  pinned,
}: {
  models: readonly IModelOption[]
  pinned: readonly string[]
}): readonly IModelOption[] => {
  const held = new Set(pinned)
  return models.filter((model) => !held.has(model.id))
}

export const togglePinnedModel = ({
  pinned,
  id,
}: {
  pinned: readonly string[]
  id: string
}): string[] => (pinned.includes(id) ? pinned.filter((entry) => entry !== id) : [...pinned, id])

export const personalModelLabelOf = ({
  models,
  personalId,
}: {
  models: readonly IModelOption[]
  personalId: string
}): string | null => models.find((model) => model.id === personalId)?.label ?? null

export const searchModelsOf = ({
  models,
  query,
}: {
  models: readonly IModelOption[]
  query: string
}): readonly IModelOption[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return models
  return models.filter((model) => `${model.label} ${model.provider}`.toLowerCase().includes(needle))
}

const RUNGS = new Map<string, number>(EFFORT_LADDER.map((rung, index) => [rung, index]))

const rungOf = (name: string): number => RUNGS.get(name) ?? -1

const clampedEffortOf = ({
  offered,
  effort,
}: {
  offered: readonly string[]
  effort: string | null
}): string => {
  const asked = effort ?? DEFAULT_EFFORT
  if (offered.length === 0) return DEFAULT_EFFORT
  if (offered.includes(asked)) return asked
  const rung = rungOf(asked)
  return offered.find((candidate) => rungOf(candidate) > rung) ?? offered.at(-1) ?? DEFAULT_EFFORT
}

export const selectionOf = ({
  models,
  modelId,
  effort,
  fast,
}: {
  models: readonly IModelOption[]
  modelId: string | null
  effort: string | null
  fast: boolean
}): IModelSelection | null => {
  const model = models.find((entry) => entry.id === modelId)
  if (model === undefined) return null
  return {
    model,
    effort: clampedEffortOf({ offered: model.efforts, effort }),
    fast: fast && model.fast,
  }
}

export const modelTriggerLabelOf = ({
  models,
  selection,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
}): string =>
  models.find((model) => model.id === selection?.model.id)?.label ??
  selection?.model.label ??
  NO_MODEL_LABEL

export const effortChoicesOf = (selection: IModelSelection | null): string[] =>
  selection === null
    ? []
    : EFFORT_LADDER.filter((effort) => selection.model.efforts.includes(effort))
