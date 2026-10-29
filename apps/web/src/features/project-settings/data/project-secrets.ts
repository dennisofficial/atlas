import { relativeTimeOf } from '@/features/settings/data/shared/relative-time'
import type { ListedSecret } from '@/features/settings/data/shared/resource-api'

import type { SecretRow } from '../fixtures/project-settings'

export function projectSecretRows({
  secrets,
  now,
}: {
  secrets: readonly ListedSecret[]
  now: number
}): SecretRow[] {
  return secrets.map((secret) => ({
    name: secret.name,
    updated: relativeTimeOf({ iso: secret.updatedAt, now }),
  }))
}
