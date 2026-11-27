import type { McpOauthGrant } from './types'

export const PENDING_TTL_MS = 10 * 60_000
export const FRESH_MARGIN_MS = 60_000
export const REFRESH_PASSES = 40
export const REFRESH_POLL_MS = 25
export const STALE_ATTEMPT_MS = 30_000
export const REJECTING_STATUSES = [400, 401]

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const needsSignIn = (): McpOauthGrant => ({
  ok: false,
  reason: 'the server has no usable grant; sign in again',
  signIn: true,
})
