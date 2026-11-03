const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS
const WEEKS_BEFORE_MONTHS = 8

export const relativeTime = ({ at, now }: { at: string; now: number }): string => {
  const elapsed = now - Date.parse(at)
  if (Number.isNaN(elapsed) || elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`
  if (elapsed < 2 * WEEK_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`
  if (elapsed < WEEKS_BEFORE_MONTHS * WEEK_MS) return `${Math.floor(elapsed / WEEK_MS)}w ago`
  return `${Math.floor(elapsed / MONTH_MS)}mo ago`
}
