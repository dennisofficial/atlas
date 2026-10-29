import type { ModelOption } from '@dltech/atlas-ui/ai/model-selector'

import { AUTO_MODEL } from '../../fixtures/settings-agent'

const AUTO_GROUP = 'Auto'

export function roleModelOptions(args: {
  offered: readonly ModelOption[]
  autoLabel: string
  currentId: string
}): ModelOption[] {
  const auto: ModelOption = {
    id: AUTO_MODEL,
    label: args.autoLabel,
    provider: AUTO_GROUP,
    monogram: 'A',
  }
  const known =
    args.currentId === AUTO_MODEL || args.offered.some((model) => model.id === args.currentId)
  const current: ModelOption[] = known ? [] : [{ id: args.currentId, label: args.currentId }]
  return [auto, ...args.offered, ...current]
}
