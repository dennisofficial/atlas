import type { SecretsPort } from '@dltech/atlas-core'

// A server's OAuth state rides the encrypted secrets store as one JSON blob, keyed by the
// normalized server URL so a reconfigured URL forces re-registration rather than leaking tokens
// across servers. This is the shape OpenCode and pi.dev converged on.

export type McpOAuthTokens = {
  accessToken: string
  refreshToken?: string
  /** ISO timestamp; absent when the server did not say how long the token lives. */
  expiresAt?: string
  scope?: string
}

export type McpOAuthClientInfo = {
  clientId: string
  clientSecret?: string
  clientIdIssuedAt?: number
  clientSecretExpiresAt?: number
}

export type McpOAuthEntry = {
  serverUrl: string
  tokens?: McpOAuthTokens
  clientInfo?: McpOAuthClientInfo
  /** Held only between the browser redirect and the code exchange; cleared on success. */
  codeVerifier?: string
}

const NAME_PREFIX = 'mcp-oauth:'

const normalizeUrl = (serverUrl: string): string => new URL(serverUrl).toString()

const isEntry = (value: unknown): value is McpOAuthEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry['serverUrl'] === 'string'
}

export class McpOAuthStore {
  constructor(private readonly args: { secrets: SecretsPort }) {}

  read(serverUrl: string): McpOAuthEntry | undefined {
    const normalized = normalizeUrl(serverUrl)
    const raw = this.args.secrets.read(NAME_PREFIX + normalized)
    if (raw === undefined) return undefined

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return undefined
    }
    if (!isEntry(parsed)) return undefined
    // A stored entry for a different URL is stale, not valid.
    if (parsed.serverUrl !== normalized) return undefined
    return parsed
  }

  write(serverUrl: string, entry: Omit<McpOAuthEntry, 'serverUrl'>): void {
    const normalized = normalizeUrl(serverUrl)
    this.args.secrets.write({
      name: NAME_PREFIX + normalized,
      value: JSON.stringify({ ...entry, serverUrl: normalized }),
    })
  }

  remove(serverUrl: string): void {
    this.args.secrets.remove(NAME_PREFIX + normalizeUrl(serverUrl))
  }

  /** Clears tokens (and any in-flight verifier) but keeps the dynamic client registration. */
  clearTokens(serverUrl: string): void {
    const entry = this.read(serverUrl)
    if (entry === undefined) return
    const { tokens: _tokens, codeVerifier: _verifier, ...rest } = entry
    this.write(serverUrl, rest)
  }
}
