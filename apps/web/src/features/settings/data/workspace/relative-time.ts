const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY
const UNKNOWN = '—'

export function relativeTimeOf({ iso, now }: { iso: string; now: number }): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return UNKNOWN
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < MINUTE) return 'just now'
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d ago`
  if (seconds < MONTH) return `${Math.floor(seconds / WEEK)}w ago`
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo ago`
  return `${Math.floor(seconds / YEAR)}y ago`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return UNKNOWN
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function daysUntil({ iso, now }: { iso: string; now: number }): number {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 0
  return Math.max(0, Math.ceil((then - now) / (DAY * 1000)))
}
