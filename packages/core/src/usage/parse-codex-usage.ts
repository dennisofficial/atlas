import { EUsageWindow, type AccountUsage, type UsageWindow } from './window'

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

function resetOf(args: { window: RawWindow; nowMs: number }): string | null {
  const { window, nowMs } = args
  if (isFiniteNumber(window.reset_at)) return isoOf(window.reset_at * 1000)
  if (isFiniteNumber(window.reset_after_seconds)) {
    return isoOf(nowMs + window.reset_after_seconds * 1000)
  }
  return null
}

function readWindow(args: { raw: unknown; nowMs: number }): UsageWindow | null {
  const { raw, nowMs } = args
  if (raw === null || typeof raw !== 'object') return null

  const window = raw as RawWindow
  if (!isFiniteNumber(window.used_percent)) return null

  return {
    utilization: Math.round(Math.min(100, Math.max(0, window.used_percent))),
    resetsAt: resetOf({ window, nowMs }),
  }
}

export function parseCodexUsage(args: { body: unknown; nowMs: number }): AccountUsage {
  const { body, nowMs } = args
  const rateLimit =
    body !== null && typeof body === 'object' ? (body as Record<string, unknown>).rate_limit : null
  if (rateLimit === null || typeof rateLimit !== 'object') {
    return { [EUsageWindow.FiveHour]: null, [EUsageWindow.SevenDay]: null }
  }

  const root = rateLimit as Record<string, unknown>
  return {
    [EUsageWindow.FiveHour]: readWindow({ raw: root.primary_window, nowMs }),
    [EUsageWindow.SevenDay]: readWindow({ raw: root.secondary_window, nowMs }),
  }
}
