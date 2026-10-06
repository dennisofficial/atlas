import { randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { OauthClock } from './oauth-connections.types'
import type { StoredTokens } from './oauth-connections.types'

export const MAX_REFRESH_SKEW_MS = 5 * 60_000
export const SKEW_FRACTION = 0.1
export const USABLE_MARGIN_MS = 15_000
export const STALE_ATTEMPT_MS = 30_000
export const WAIT_BUDGET_MS = 12_000
export const WAIT_POLL_MS = 200

export const newAttemptId = (): string => randomBytes(16).toString('hex')

export function skewOf(tokens: StoredTokens): number {
  const lifetime = Date.parse(tokens.expiresAt) - Date.parse(tokens.issuedAt)
  return Math.min(MAX_REFRESH_SKEW_MS, Math.max(0, lifetime) * SKEW_FRACTION)
}

export const refreshAfterMs = (tokens: StoredTokens): number =>
  Date.parse(tokens.expiresAt) - skewOf(tokens)

export const isDue = (args: { tokens: StoredTokens; nowMs: number }): boolean =>
  args.nowMs >= refreshAfterMs(args.tokens)

export const isUsable = (args: { tokens: StoredTokens; nowMs: number }): boolean =>
  Date.parse(args.tokens.expiresAt) - args.nowMs > USABLE_MARGIN_MS

@Injectable()
export class SystemOauthClock implements OauthClock {
  now(): number {
    return Date.now()
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
