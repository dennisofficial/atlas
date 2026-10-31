import { ENV_NAME_PATTERN } from '@dltech/atlas-wire/web'

export { parseEnvLines } from '@/features/settings/parts/env-secrets-dialogs'
export type { SecretPair } from '@/features/settings/parts/env-secrets-dialogs'

import type { SecretPair } from '@/features/settings/parts/env-secrets-dialogs'

export function secretsErrorOf(pairs: readonly SecretPair[]): string | null {
  const seen = new Set<string>()
  for (const pair of pairs) {
    if (!ENV_NAME_PATTERN.test(pair.name)) {
      return 'Use letters, digits, and underscores for names, not starting with a digit (maximum 200 characters).'
    }
    if (seen.has(pair.name)) return `Duplicate name: ${pair.name}. Remove or rename it.`
    if (pair.value === '') return `Enter a value for ${pair.name}.`
    seen.add(pair.name)
  }
  return null
}
