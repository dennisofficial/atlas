import {
  EAccountOrigin,
  EAccountStatus,
  EAuthKind,
  EAuthProvider,
  refKey,
  supportedEfforts,
  toAccountId,
  type Account,
  type ModelCard,
} from '@dltech/atlas-core'

import { catalogueProviders, composeModelCatalogue } from './catalogue-composition'
import { OPENAI_PROVIDER_ID } from './provider-ids'

export type HeldAccount = { id: string; provider: string; kind: string; status: string }

export type ModelsViewModel = {
  id: string
  label: string
  contextWindow: number
  imageTier: string
  efforts: string[]
  inputPerMillion?: number
}

export type ModelsViewProvider = {
  id: string
  label: string
  status: 'connected' | 'expired'
  live: boolean
  models: ModelsViewModel[]
}

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set(Object.values(EAuthProvider))
const EPOCH = new Date(0).toISOString()

const toAccount = (held: HeldAccount): Account => ({
  id: toAccountId(held.id),
  provider: held.provider as EAuthProvider,
  kind: held.kind === EAuthKind.Oauth ? EAuthKind.Oauth : EAuthKind.ApiKey,
  origin: EAccountOrigin.Login,
  label: held.provider,
  status: held.status === 'expired' ? EAccountStatus.Expired : EAccountStatus.Active,
  createdAt: EPOCH,
  updatedAt: EPOCH,
})

const toModel = (card: ModelCard): ModelsViewModel => ({
  id: refKey(card.ref),
  label: card.label,
  contextWindow: card.contextWindow,
  imageTier: card.imageTier,
  efforts: [...supportedEfforts(card.effort)],
  ...(card.cost === undefined ? {} : { inputPerMillion: card.cost.inputPerMillion }),
})

export function modelsView(args: {
  accounts: readonly HeldAccount[]
  liveCards?: (providerId: string) => readonly ModelCard[] | undefined
}): ModelsViewProvider[] {
  const held = args.accounts.filter((account) => KNOWN_PROVIDERS.has(account.provider))
  const working = held.filter((account) => account.status !== 'expired')
  const catalogue = composeModelCatalogue({
    providers: catalogueProviders(),
    accounts: working.map(toAccount),
    ...(args.liveCards === undefined
      ? {}
      : {
          live: {
            cards: args.liveCards,
            subscribe: () => () => {},
            refresh: async () => {},
          },
        }),
  })

  return catalogue.providers.flatMap((provider): ModelsViewProvider[] => {
    if (!held.some((account) => account.provider === provider.id)) return []
    if (!working.some((account) => account.provider === provider.id)) {
      return [
        { id: provider.id, label: provider.label, status: 'expired', live: false, models: [] },
      ]
    }
    const live =
      provider.id === OPENAI_PROVIDER_ID &&
      catalogue.subscribed(provider.id) &&
      (args.liveCards?.(provider.id)?.length ?? 0) > 0
    return [
      {
        id: provider.id,
        label: provider.label,
        status: 'connected',
        live,
        models: provider.cards.map(toModel),
      },
    ]
  })
}
