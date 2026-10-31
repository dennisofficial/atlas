const pad = (value: number): string => String(value).padStart(2, '0')

export function clockTimeOf(at: string | undefined): string | undefined {
  if (at === undefined) return undefined
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return undefined
  const hours = date.getHours()
  return `${hours % 12 || 12}:${pad(date.getMinutes())} ${hours >= 12 ? 'PM' : 'AM'}`
}

export function spanMsOf(args: {
  startedAt: string | undefined
  endedAt: string | undefined
  now: number
  running: boolean
}): number {
  const start = args.startedAt === undefined ? Number.NaN : Date.parse(args.startedAt)
  if (Number.isNaN(start)) return 0
  const end = args.running ? args.now : Date.parse(args.endedAt ?? '')
  if (Number.isNaN(end)) return 0
  return Math.max(0, end - start)
}
