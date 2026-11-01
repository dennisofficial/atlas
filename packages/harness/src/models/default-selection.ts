import { refKey, type ModelRef } from '@dltech/atlas-core'

export const SHIPPED_DEFAULT_REF: ModelRef = {
  providerId: 'anthropic',
  modelId: 'claude-haiku-4-5',
}

export type OfferedModel = { id: string; reachable: boolean }

export function defaultModelId(args: {
  offered: readonly OfferedModel[]
  personalId: string
}): string | undefined {
  const reachable = args.offered.filter((model) => model.reachable)
  const preferred = [args.personalId, refKey(SHIPPED_DEFAULT_REF)]
  const wanted = preferred.find((id) => reachable.some((model) => model.id === id))
  return wanted ?? reachable[0]?.id
}
