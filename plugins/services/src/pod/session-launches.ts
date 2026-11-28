const launches = new Map<string, Map<string, Promise<void>>>()

export const trackSessionLaunch = (args: {
  sessionId: string
  serviceId: string
  settled: Promise<void>
}): void => {
  const kept = launches.get(args.sessionId) ?? new Map<string, Promise<void>>()
  kept.set(args.serviceId, args.settled)
  launches.set(args.sessionId, kept)
}

export const forgetSessionLaunch = (args: { sessionId: string; serviceId: string }): void => {
  const kept = launches.get(args.sessionId)
  if (kept === undefined) return
  kept.delete(args.serviceId)
  if (kept.size === 0) launches.delete(args.sessionId)
}

export const sessionLaunchOf = (args: {
  sessionId: string
  serviceId: string
}): Promise<void> | undefined => launches.get(args.sessionId)?.get(args.serviceId)
