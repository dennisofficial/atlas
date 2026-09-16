import {
  ESettingId,
  parseRef,
  textValueOf,
  type ModelRef,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { isRefReachable, type ModelCatalogue } from './model-catalogue'
import { defaultSelection } from './model-preference'

const cheapestReachable = (catalogue: ModelCatalogue): ModelRef | undefined => {
  let best: { ref: ModelRef; price: number } | undefined

  for (const provider of catalogue.providers) {
    if (!catalogue.reachable(provider.id)) continue
    for (const card of provider.cards) {
      const price = card.cost?.outputPerMillion
      if (price === undefined) continue
      if (best === undefined || price < best.price) best = { ref: card.ref, price }
    }
  }

  return best?.ref
}

/**
 * Where an unset model row's picker should open. The quick tier suggests the cheapest card any
 * connected provider carries; a per-type row suggests what it would resolve to (the sub-agent
 * role, then the default); everything else opens on the default the conversation would run.
 */
export function suggestedModelRef(args: {
  id: string
  settled: SettingsResolution
  catalogue: ModelCatalogue
}): ModelRef {
  const followed = defaultSelection({ settled: args.settled, catalogue: args.catalogue }).ref

  if (args.id === ESettingId.QuickModel) {
    return cheapestReachable(args.catalogue) ?? followed
  }

  if (args.id.startsWith('agents.type.')) {
    const held = textValueOf({ resolution: args.settled, id: ESettingId.SubagentModel })
    const ref = parseRef(held)
    if (ref !== undefined && isRefReachable({ catalogue: args.catalogue, ref })) return ref
  }

  return followed
}
