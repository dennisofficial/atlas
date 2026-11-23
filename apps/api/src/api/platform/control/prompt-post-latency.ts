const CLOCK_SKEW_CEILING_MS = 60_000

export const clientToApiMsOf = (args: {
  sentAt: string | undefined
  serverNow: number
}): number | undefined => {
  if (args.sentAt === undefined) return undefined
  const sentAt = Date.parse(args.sentAt)
  if (Number.isNaN(sentAt)) return undefined
  const ms = args.serverNow - sentAt
  if (ms < 0 || ms > CLOCK_SKEW_CEILING_MS) return undefined
  return ms
}
