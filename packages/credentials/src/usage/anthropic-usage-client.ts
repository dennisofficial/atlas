import {
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type AccountUsage,
  type CredentialPort,
  parseAnthropicUsage,
} from '@dltech/atlas-core'

import type { UsageClient } from './usage-client'

// Undocumented: Claude Code's own usage endpoint. It needs the `user:profile` scope and the Claude
// Code user-agent; inference responses carry no plan-window headers.
export const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const REQUEST_TIMEOUT_MS = 10_000
const OAUTH_BETA = 'oauth-2025-04-20'

export class AnthropicUsageClient implements UsageClient {
  private readonly credentials: CredentialPort
  private readonly clientVersion: string
  private readonly fetch: typeof globalThis.fetch

  constructor(args: {
    credentials: CredentialPort
    clientVersion: string
    fetch?: typeof globalThis.fetch
  }) {
    this.credentials = args.credentials
    this.clientVersion = args.clientVersion
    this.fetch = args.fetch ?? globalThis.fetch
  }

  async read(args: { accountId?: AccountId | undefined }): Promise<AccountUsage | null> {
    try {
      const credential = await this.credentials.read({
        provider: EAuthProvider.Anthropic,
        accountId: args.accountId,
      })
      if (credential.kind !== EAuthKind.Oauth) return null

      const response = await this.fetch(ANTHROPIC_USAGE_URL, {
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          'anthropic-beta': OAUTH_BETA,
          'user-agent': `claude-code/${this.clientVersion}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return null

      return parseAnthropicUsage(await response.json())
    } catch {
      return null
    }
  }
}
