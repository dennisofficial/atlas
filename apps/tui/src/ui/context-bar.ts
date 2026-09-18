import { theme } from './theme'

export const CONTEXT_WARN_PERCENT = 75

export const CONTEXT_WARN_TOKENS = 200_000

export const CONTEXT_DANGER_TOKENS = 300_000

export const COMPACT_COMMAND = '/compact'

export function isContextWarning(percent: number): boolean {
  return percent > CONTEXT_WARN_PERCENT
}

export function contextUsageTone(tokens: number): string {
  if (tokens >= CONTEXT_DANGER_TOKENS) return theme.error
  if (tokens >= CONTEXT_WARN_TOKENS) return theme.warn
  return theme.meta
}

/**
 * Absolute tokens outrank the percent: a 300k reading is dangerous in any window, while a 76%
 * reading in a small window is still worth a warning even at 150k tokens.
 */
export function contextTone(args: { percent: number; tokens?: number | undefined }): string {
  if (args.tokens !== undefined) {
    const tone = contextUsageTone(args.tokens)
    if (tone !== theme.meta) return tone
  }
  return isContextWarning(args.percent) ? theme.warn : theme.meta
}
