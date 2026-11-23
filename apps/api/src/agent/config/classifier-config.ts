import { ESettingId } from '@dltech/atlas-core'
import {
  classifierAvailabilityOf,
  classifierConfigFrom,
  type ClassifierConfig,
  type ClassifierCredential,
} from '@dltech/atlas-classifier'
import {
  classifierCredentialOf,
  parsedAccountsOf,
  type ProviderCredential,
} from '@dltech/atlas-credentials'
import { readOf } from '@dltech/atlas-models'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'

import type { ActiveAccountRow, AccountRow } from './model-config'

const toClassifierCredential = (
  credential: ProviderCredential | null,
): ClassifierCredential | null =>
  credential === null
    ? null
    : credential.kind === 'api-key'
      ? { kind: 'api-key', accountId: credential.accountId, apiKey: credential.apiKey }
      : { kind: 'plan', accountId: credential.accountId }

export function classifierConfigOf(args: {
  cipher: Pick<SecretCipher, 'decrypt'>
  accounts: readonly AccountRow[]
  activeAccounts: readonly ActiveAccountRow[]
  settings: ReadonlyMap<string, string>
}): ClassifierConfig {
  const parsed = parsedAccountsOf(args.accounts)
  const stored = readOf(args.settings)(ESettingId.ClassifierModel)
  const availability = classifierAvailabilityOf({
    stored: typeof stored === 'string' ? stored : undefined,
    credentialOf: (provider) =>
      toClassifierCredential(
        classifierCredentialOf({
          provider,
          parsed,
          activeAccounts: args.activeAccounts,
          unseal: (sealed) => args.cipher.decrypt(sealed),
        }),
      ),
  })
  return classifierConfigFrom(availability)
}
