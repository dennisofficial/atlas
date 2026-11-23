const UNPOLLED = '—'

export function formatUtilization(utilization: number | null): string {
  if (utilization === null) return UNPOLLED
  return `${Math.round(utilization)}%`
}

export function formatCountdown(args: { resetsAt: string | null; now: number }): string {
  if (args.resetsAt === null) return ''

  const remaining = Date.parse(args.resetsAt) - args.now
  if (!Number.isFinite(remaining)) return ''
  if (remaining <= 0) return 'now'

  const minutes = Math.round(remaining / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours === 0) return `${minutes}m`

  const days = Math.floor(hours / 24)
  if (days === 0) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`
}
