import { ESecretKind } from '@dltech/atlas-wire/web'

import { relativeTimeOf } from '@/features/settings/data/shared/relative-time'
import type { ListedSecret } from '@/features/settings/data/shared/resource-api'

import type { SecretRow } from '../fixtures/project-settings'

export type SecretPairInput = { name: string; value: string; kind: ESecretKind }

export function projectSecretRows({
  secrets,
  now,
}: {
  secrets: readonly ListedSecret[]
  now: number
}): SecretRow[] {
  return secrets.map((secret) => ({
    name: secret.name,
    value: secret.value,
    updated: relativeTimeOf({ iso: secret.updatedAt, now }),
  }))
}
