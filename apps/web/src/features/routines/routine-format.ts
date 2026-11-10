const MINUTE_MS = 60_000
const HOUR_MINUTES = 60
const HOURS_PER_DAY = 1440

const unitOf = (minutes: number): string => {
  if (minutes < HOUR_MINUTES) return `${minutes}m`
  if (minutes < HOURS_PER_DAY + 12 * HOUR_MINUTES) return `${Math.round(minutes / HOUR_MINUTES)}h`
  return `${Math.round(minutes / HOURS_PER_DAY)}d`
}

export const relativeOf = (args: { from: number; to: string }): string => {
  const minutes = Math.round((Date.parse(args.to) - args.from) / MINUTE_MS)
  const magnitude = Math.abs(minutes)
  if (magnitude < 1) return 'now'
  return minutes > 0 ? `in ${unitOf(magnitude)}` : `${unitOf(magnitude)} ago`
}

export const dateAt = (args: { iso: string; timeZone: string }): string =>
  new Date(args.iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: args.timeZone,
  })

export const clockAt = (args: { iso: string; timeZone: string }): string =>
  new Date(args.iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: args.timeZone,
  })
