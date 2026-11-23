import { EUsageWindow, worstWindow, type AccountUsage, type UsageWindow } from './window'

type RawWindow = { utilization?: unknown; resets_at?: unknown }

function readWindow(raw: unknown): UsageWindow | null {
  if (raw === null || typeof raw !== 'object') return null

  const window = raw as RawWindow
  if (typeof window.utilization !== 'number' || !Number.isFinite(window.utilization)) return null

  return {
    utilization: Math.round(Math.min(100, Math.max(0, window.utilization))),
    resetsAt: typeof window.resets_at === 'string' ? window.resets_at : null,
  }
}

export function parseAnthropicUsage(body: unknown): AccountUsage {
  if (body === null || typeof body !== 'object') {
    return { [EUsageWindow.FiveHour]: null, [EUsageWindow.SevenDay]: null }
  }

  const root = body as Record<string, unknown>
  return {
    [EUsageWindow.FiveHour]: readWindow(root.five_hour),
    [EUsageWindow.SevenDay]: worstWindow(
      [root.seven_day, root.seven_day_opus, root.seven_day_sonnet].map(readWindow),
    ),
  }
}
