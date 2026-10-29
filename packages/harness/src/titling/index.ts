import type { LanguageModelV4 } from '@ai-sdk/provider'
import {
  ATLAS_SETTINGS,
  EEffort,
  ESettingsLayer,
  EUtilityModelRole,
  resolveSettings,
  textValueOf,
  utilitySettingFor,
  resolveUtilityModel,
  type Account,
  type CredentialPort,
  type ModelRef,
  type NoticePort,
  type SaidImage,
  type SettingsResolution,
} from '@dltech/atlas-core'
import { decodeSettingValue } from '@dltech/atlas-wire/web'

import {
  modelCatalogue,
  providerAdapters,
  type ModelCatalogue,
} from '../composition/model-catalogue'
import { defaultSelection } from '../composition/model-preference'
import { createUtilityModel } from '../composition/utility-model'
import { titleFor } from '../model/titler'

export { namingTextOf } from '../model/naming-text'
export {
  accountSchema,
  chooseAccount,
  CredentialPort,
  EAccountChoice,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type Account,
  type AccountId,
  type SaidImage,
  type Credential,
  type CredentialRequest,
} from '@dltech/atlas-core'

const CLOUD_ORIGIN = 'cloud'

const silentNotices: NoticePort = { notify: () => undefined }

const resolutionOf = (settings: Readonly<Record<string, string>>): SettingsResolution =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [
      {
        layer: ESettingsLayer.Cloud,
        origin: CLOUD_ORIGIN,
        values: Object.fromEntries(
          Object.entries(settings).map(([key, value]) => [key, decodeSettingValue(value)]),
        ),
      },
    ],
  })

const catalogueOf = (args: {
  credentials: CredentialPort
  accounts: readonly Account[]
}): ModelCatalogue =>
  modelCatalogue({
    adapters: providerAdapters({ credentials: args.credentials }),
    accounts: args.accounts,
  })

const unreachable: CredentialPort = {
  read: () => Promise.reject(new Error('no credentials')),
  discard: () => Promise.resolve(),
}

export function titlerRefOf(args: {
  settings: Readonly<Record<string, string>>
  accounts: readonly Account[]
}): ModelRef {
  const settled = resolutionOf(args.settings)
  const catalogue = catalogueOf({ credentials: unreachable, accounts: args.accounts })
  return resolveUtilityModel({
    role: EUtilityModelRole.Titler,
    override: textValueOf({ resolution: settled, id: utilitySettingFor(EUtilityModelRole.Titler) }),
    followDefault: defaultSelection({ settled, catalogue }).ref,
    catalogue: catalogue.catalog,
  })
}

export type StandaloneTitler = (args: {
  text: string
  images?: readonly SaidImage[] | undefined
  signal?: AbortSignal | undefined
}) => Promise<string | null>

export function createStandaloneTitler(args: {
  settings: Readonly<Record<string, string>>
  accounts: readonly Account[]
  credentials: CredentialPort
  fallbackRef?: ModelRef | undefined
}): StandaloneTitler {
  const settled = resolutionOf(args.settings)
  const catalogue = catalogueOf({ credentials: args.credentials, accounts: args.accounts })

  const fallback = (): LanguageModelV4 | undefined => {
    if (args.fallbackRef === undefined) return undefined
    const card = catalogue.cardFor(args.fallbackRef)
    const adapter = catalogue.adapterFor(args.fallbackRef.providerId)
    if (card === undefined || adapter === undefined) return undefined
    return adapter.model({ card, effort: () => EEffort.Low })
  }

  const model = createUtilityModel({
    role: EUtilityModelRole.Titler,
    settled: () => settled,
    catalogue,
    notice: silentNotices,
    fallback,
  })

  return ({ text, images, signal }) => titleFor({ model, text, images, signal }).catch(() => null)
}
