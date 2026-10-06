import { EAuthKind, EAuthProvider, type StoredAccount } from '@dltech/atlas-core'

import { sameUrl } from './oauth-owned-secret'

const CLI_IMPORT_SOURCES: readonly string[] = ['claude-code', 'codex']
const HANDOFF_PROVIDERS: readonly EAuthProvider[] = [EAuthProvider.Anthropic, EAuthProvider.OpenAI]

export const isOauthHandoffCandidate = (args: { stored: StoredAccount; cloudUrl: string }): boolean => {
  const { stored } = args
  if (stored.secret.kind !== EAuthKind.Oauth) return false

  const { authority, tokens } = stored.secret
  if (authority !== undefined) return sameUrl(authority.url, args.cloudUrl)

  if (!HANDOFF_PROVIDERS.includes(stored.provider)) return false
  if (tokens.refreshToken.length === 0) return false
  return !CLI_IMPORT_SOURCES.includes(stored.importedFrom ?? '')
}
