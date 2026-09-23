export const FAKE_ACCESS_TOKEN = 'fake-access-token-not-a-real-secret'
export const FAKE_REFRESH_TOKEN = 'fake-refresh-token-not-a-real-secret'

export const FAKE_EXPIRES_AT_EPOCH_MILLIS = 1_800_000_000_000
export const FAKE_EXPIRES_AT_ISO = new Date(FAKE_EXPIRES_AT_EPOCH_MILLIS).toISOString()

export const fakeClaudeCredentialBlob = (
  overrides: { accessToken?: unknown; expiresAt?: unknown } = {},
): string =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: 'accessToken' in overrides ? overrides.accessToken : FAKE_ACCESS_TOKEN,
      refreshToken: FAKE_REFRESH_TOKEN,
      expiresAt: 'expiresAt' in overrides ? overrides.expiresAt : FAKE_EXPIRES_AT_EPOCH_MILLIS,
      refreshTokenExpiresAt: FAKE_EXPIRES_AT_EPOCH_MILLIS,
      scopes: ['user:inference'],
      subscriptionType: 'fake',
    },
    mcpOAuth: {},
  })

export const FAKE_CODEX_ACCOUNT_ID = 'c1fa07f1-3e5f-49bf-839e-1b43b2810c7f'
export const FAKE_CODEX_EXPIRY_EPOCH_SECONDS = 1_900_000_000
export const FAKE_CODEX_REFRESH_TOKEN = 'fake-codex-refresh-token-not-a-real-secret'

export const fakeJwt = (claims: Record<string, unknown>): string => {
  const segment = (value: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url')

  return `${segment({ alg: 'RS256', typ: 'JWT' })}.${segment(claims)}.fake-signature`
}

export const fakeCodexAccessToken = (): string =>
  fakeJwt({ exp: FAKE_CODEX_EXPIRY_EPOCH_SECONDS })

export const fakeCodexIdToken = (
  claims: Record<string, unknown> = {
    email: 'dennis@example.com',
    'https://api.openai.com/auth': {
      chatgpt_account_id: FAKE_CODEX_ACCOUNT_ID,
      chatgpt_plan_type: 'pro',
    },
  },
): string => fakeJwt(claims)

export const fakeCodexAuthPayload = (
  overrides: { accessToken?: string; idToken?: string; tokens?: unknown } = {},
): string =>
  'tokens' in overrides
    ? JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: overrides.tokens })
    : JSON.stringify({
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: overrides.idToken ?? fakeCodexIdToken(),
          access_token: overrides.accessToken ?? fakeCodexAccessToken(),
          refresh_token: FAKE_CODEX_REFRESH_TOKEN,
          account_id: FAKE_CODEX_ACCOUNT_ID,
        },
        last_refresh: '2026-09-21T17:34:36.346835Z',
      })
