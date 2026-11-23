import { EUsageWindow, worstWindow, type AccountUsage, type UsageWindow } from './window'

type RawWindow = {
  used_percent?: unknown
  reset_at?: unknown
  reset_after_seconds?: unknown
  limit_window_seconds?: unknown
}

const DAY_SECONDS = 86_400

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
  const slotted = [
    { raw: root.primary_window, fallback: EUsageWindow.FiveHour },
    { raw: root.secondary_window, fallback: EUsageWindow.SevenDay },
  ].map((entry) => ({
    slot: slotOf({ raw: entry.raw, fallback: entry.fallback }),
    window: readWindow({ raw: entry.raw, nowMs }),
  }))
  const windowsIn = (slot: EUsageWindow) =>
    slotted.filter((entry) => entry.slot === slot).map((entry) => entry.window)
  return {
    [EUsageWindow.FiveHour]: worstWindow(windowsIn(EUsageWindow.FiveHour)),
    [EUsageWindow.SevenDay]: worstWindow(windowsIn(EUsageWindow.SevenDay)),
  }
}

function slotOf(args: { raw: unknown; fallback: EUsageWindow }): EUsageWindow {
  if (args.raw === null || typeof args.raw !== 'object') return args.fallback
  const length = (args.raw as RawWindow).limit_window_seconds
  if (!isFiniteNumber(length)) return args.fallback
  return length < DAY_SECONDS ? EUsageWindow.FiveHour : EUsageWindow.SevenDay
}
