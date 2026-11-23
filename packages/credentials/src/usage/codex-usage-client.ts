import {
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type AccountUsage,
  type CredentialPort,
  parseCodexUsage,
} from '@dltech/atlas-core'

import type { UsageClient } from './usage-client'

// Mirrors what codex-rs calls: backend-client/src/client/rate_limit_resets.rs
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

const REQUEST_TIMEOUT_MS = 10_000

export class CodexUsageClient implements UsageClient {
  private readonly credentials: CredentialPort
  private readonly clientVersion: string
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number

  constructor(args: {
    credentials: CredentialPort
    clientVersion: string
    fetch?: typeof globalThis.fetch
    now?: () => number
  }) {
    this.credentials = args.credentials
    this.clientVersion = args.clientVersion
    this.fetch = args.fetch ?? globalThis.fetch
    this.now = args.now ?? Date.now
  }

  async read(args: { accountId?: AccountId | undefined }): Promise<AccountUsage | null> {
    try {
      const credential = await this.credentials.read({
        provider: EAuthProvider.OpenAI,
        accountId: args.accountId,
      })
      if (credential.kind !== EAuthKind.Oauth) return null

      const response = await this.fetch(CODEX_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          ...(credential.providerAccountId === undefined
            ? {}
            : { 'ChatGPT-Account-ID': credential.providerAccountId }),
          'user-agent': `codex-cli/${this.clientVersion}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return null

      return parseCodexUsage({ body: await response.json(), nowMs: this.now() })
    } catch {
      return null
    }
  }
}
