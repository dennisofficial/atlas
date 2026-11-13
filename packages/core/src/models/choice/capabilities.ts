import { findCard, type ModelCatalog } from '../card'
import { supportedEfforts, type EEffort } from '../effort-ladder'
import type { ModelRef } from '../ref'

export type ModelCapabilities = { efforts: readonly EEffort[]; fast: boolean; runnable: boolean }

export type CapabilitiesOf = (ref: ModelRef) => ModelCapabilities | undefined

export function capabilitiesFromCatalog(args: {
  catalog: ModelCatalog
  reachable: (providerId: string) => boolean
}): CapabilitiesOf {
  return (ref) => {
    const card = findCard({ catalog: args.catalog, ref })
    if (card === undefined) return undefined
    return {
      efforts: supportedEfforts(card.effort),
      fast: card.fast === true,
      runnable: args.reachable(ref.providerId),
    }
  }
}
