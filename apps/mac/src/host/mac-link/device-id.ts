export const createDeviceId = (args: {
  read: () => string | undefined
  write: (value: string) => void
}): (() => string) => {
  let cached: string | undefined
  return () => {
    if (cached !== undefined) return cached
    const stored = args.read()
    cached = stored ?? crypto.randomUUID()
    if (stored === undefined) args.write(cached)
    return cached
  }
}
