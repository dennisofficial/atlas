import type { ModelsResponse } from '@dltech/atlas-wire/web'

export const EFFORT_LADDER = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const DEFAULT_EFFORT = 'medium'

export const NO_MODEL_LABEL = 'Default'

const NO_KEY_NOTE = 'no key'

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
  efforts: readonly string[]
  context: string
  disabled: boolean
  note: string | null
}

export interface IModelSelection {
  model: IModelOption
  effort: string
}

const labelOf = (label: string): string =>
  label.startsWith(CLAUDE_PREFIX) ? label.slice(CLAUDE_PREFIX.length) : label

const contextLabelOf = (tokens: number): string =>
  tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1_000)}k`

export const modelOptionsOf = (response: ModelsResponse): IModelOption[] =>
  response.providers
    .filter((provider) => provider.status !== 'expired')
    .flatMap((provider) =>
      provider.models.map((model) => {
        const disabled = provider.status !== 'connected'
        return {
          id: model.id,
          label: labelOf(model.label),
          provider: provider.label,
          efforts: model.efforts,
          context: contextLabelOf(model.contextWindow),
          disabled,
          note: disabled ? NO_KEY_NOTE : null,
        }
      }),
    )

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
}: {
  models: readonly IModelOption[]
  modelId: string | null
  effort: string | null
}): IModelSelection | null => {
  const model = models.find((entry) => entry.id === modelId)
  if (model === undefined) return null
  return { model, effort: clampedEffortOf({ offered: model.efforts, effort }) }
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
