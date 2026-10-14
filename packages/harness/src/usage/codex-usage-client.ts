import {
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type AccountUsage,
  type CredentialPort,
} from '@dltech/atlas-core'

import { CODEX_VERSION } from '../providers/codex-version'
import { parseCodexUsage } from './parse-codex-usage'

/**
 * The subscription's 5-hour / weekly plan windows. Mirrors what codex-rs itself calls
 * (backend-client/src/client/rate_limit_resets.rs:124); the endpoint wants only a bearer token,
 * the ChatGPT account id, and some user-agent, so we present the Codex CLI's.
 */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

const REQUEST_TIMEOUT_MS = 10_000

export class CodexUsageClient {
  private readonly credentials: CredentialPort
  private readonly fetch: typeof globalThis.fetch

  constructor(args: { credentials: CredentialPort; fetch?: typeof globalThis.fetch }) {
    this.credentials = args.credentials
    this.fetch = args.fetch ?? globalThis.fetch
  }

  /** A meter is decoration: losing one must never take a turn, or opening a thread, down. */
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
          'user-agent': `codex-cli/${CODEX_VERSION}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return null

      return parseCodexUsage(await response.json())
    } catch {
      return null
    }
  }
}
