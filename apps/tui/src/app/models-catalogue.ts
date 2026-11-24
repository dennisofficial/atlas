import {
  DEFAULT_IMAGE_TIER,
  EEffort,
  EImageTier,
  parseRef,
  type EffortMap,
  type ModelCard,
} from '@dltech/atlas-core'
import type { CatalogueProvider } from '@dltech/atlas-models'

import type { ModelsEntry, ModelsReply } from './session-api'

const TIERS: Readonly<Record<string, EImageTier>> = {
  [EImageTier.Standard]: EImageTier.Standard,
  [EImageTier.HighResolution]: EImageTier.HighResolution,
}

const isEffort = (value: string): value is EEffort =>
  (Object.values(EEffort) as readonly string[]).includes(value)

const imageTierOf = (value: string | undefined): EImageTier =>
  value === undefined ? DEFAULT_IMAGE_TIER : (TIERS[value] ?? DEFAULT_IMAGE_TIER)

export const effortsOf = (entry: ModelsEntry): EffortMap => {
  const map: EffortMap = {}
  for (const name of entry.efforts) {
    if (isEffort(name)) map[name] = name
  }
  return map
}

export const cardOf = (args: { entry: ModelsEntry }): ModelCard | null => {
  const ref = parseRef(args.entry.id)
  if (ref === undefined) return null

  const effort = effortsOf(args.entry)
  const cost =
    typeof args.entry.inputPerMillion === 'number' &&
    typeof args.entry.outputPerMillion === 'number'
      ? {
          inputPerMillion: args.entry.inputPerMillion,
          outputPerMillion: args.entry.outputPerMillion,
        }
      : null

  return {
    ref,
    label: args.entry.label,
    api: '',
    contextWindow: args.entry.contextWindow,
    imageTier: imageTierOf(args.entry.imageTier),
    ...(Object.keys(effort).length === 0 ? {} : { effort }),
    ...(args.entry.fast === true ? { fast: true as const } : {}),
    ...(cost === null ? {} : { cost }),
  }
}

export const providersOf = (args: { models: ModelsReply }): readonly CatalogueProvider[] =>
  args.models.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    cards: provider.models.flatMap((entry) => {
      const card = cardOf({ entry })
      return card === null ? [] : [card]
    }),
  }))

export const reachableOf = (args: { models: ModelsReply }): ReadonlySet<string> =>
  new Set(
    args.models.providers
      .filter((provider) => provider.status === 'connected')
      .map((provider) => provider.id),
  )

export const providerNamesOf = (args: { models: ModelsReply }): Readonly<Record<string, string>> =>
  Object.fromEntries(args.models.providers.map((provider) => [provider.id, provider.label]))
