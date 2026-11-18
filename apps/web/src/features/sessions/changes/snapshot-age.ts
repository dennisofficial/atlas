const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const padded = (value: number): string => `${value}`.padStart(2, '0')

const clockOf = (at: Date): string => `${padded(at.getHours())}:${padded(at.getMinutes())}`

const sameDay = (args: { at: Date; now: Date }): boolean =>
  args.at.getFullYear() === args.now.getFullYear() &&
  args.at.getMonth() === args.now.getMonth() &&
  args.at.getDate() === args.now.getDate()

export function snapshotLabel(args: {
  updatedAt: number | null
  live: boolean
  now: number
}): string {
  if (args.live) return 'live'
  if (args.updatedAt === null || args.updatedAt <= 0) return 'no snapshot yet'
  const at = new Date(args.updatedAt)
  const now = new Date(args.now)
  if (sameDay({ at, now })) return `as of ${clockOf(at)}`
  return `as of ${MONTHS[at.getMonth()] ?? ''} ${at.getDate()}, ${clockOf(at)}`
}
