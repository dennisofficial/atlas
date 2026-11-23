export const contextPercentOf = (args: {
  used: number | null
  window: number | null
}): number | null => {
  if (args.used === null || args.window === null || args.window <= 0) return null
  return Math.min(100, Math.round((args.used / args.window) * 100))
}
