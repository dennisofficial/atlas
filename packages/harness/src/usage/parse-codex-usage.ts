import { EUsageWindow, type AccountUsage, type UsageWindow } from '@dltech/atlas-core'

type RawWindow = {
  used_percent?: unknown
  reset_at?: unknown
  reset_after_seconds?: unknown
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function isoOf(epochMs: number): string | null {
  const date = new Date(epochMs)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function resetOf(args: { window: RawWindow; now: () => number }): string | null {
  const { window, now } = args
  if (isFiniteNumber(window.reset_at)) return isoOf(window.reset_at * 1000)
  if (isFiniteNumber(window.reset_after_seconds)) {
    return isoOf(now() + window.reset_after_seconds * 1000)
  }
  return null
}

/**
 * `used_percent` is the share consumed (0..100), not the share remaining, and `reset_at` is unix
 * seconds. Mirrors codex-rs's RateLimitStatusPayload (backend-client, rate_limit_resets.rs).
 */
function readWindow(args: { raw: unknown; now: () => number }): UsageWindow | null {
  const { raw, now } = args
  if (raw === null || typeof raw !== 'object') return null

  const window = raw as RawWindow
  if (!isFiniteNumber(window.used_percent)) return null

  return {
    utilization: Math.round(Math.min(100, Math.max(0, window.used_percent))),
    resetsAt: resetOf({ window, now }),
  }
}

export function parseCodexUsage(body: unknown, now: () => number = Date.now): AccountUsage {
  const rateLimit =
    body !== null && typeof body === 'object' ? (body as Record<string, unknown>).rate_limit : null
  if (rateLimit === null || typeof rateLimit !== 'object') {
    return { [EUsageWindow.FiveHour]: null, [EUsageWindow.SevenDay]: null }
  }

  const root = rateLimit as Record<string, unknown>
  return {
    [EUsageWindow.FiveHour]: readWindow({ raw: root.primary_window, now }),
    [EUsageWindow.SevenDay]: readWindow({ raw: root.secondary_window, now }),
  }
}
