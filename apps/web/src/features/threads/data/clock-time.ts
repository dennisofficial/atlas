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
