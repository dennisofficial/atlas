import { refKey } from '@dltech/atlas-core'

import { SHIPPED_DEFAULT_REF } from '../session-model'

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
