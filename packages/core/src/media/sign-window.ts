export const SIGN_WINDOW_MS = 6 * 24 * 60 * 60 * 1000
export const SIGN_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000

export const windowStartOf = (nowMs: number): number =>
  Math.floor(nowMs / SIGN_WINDOW_MS) * SIGN_WINDOW_MS

export const validUntilOf = (windowStartMs: number): number => windowStartMs + SIGN_VALIDITY_MS
