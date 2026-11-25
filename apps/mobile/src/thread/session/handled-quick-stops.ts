const EMPTY_HANDLED: ReadonlySet<string> = new Set()

const handled = new Map<string, ReadonlySet<string>>()

export const handledQuickStopsOf = (sessionId: string): ReadonlySet<string> =>
  handled.get(sessionId) ?? EMPTY_HANDLED

export const rememberHandledQuickStops = (args: {
  sessionId: string
  rewindEventIds: readonly string[]
}): void => {
  handled.set(
    args.sessionId,
    new Set([...handledQuickStopsOf(args.sessionId), ...args.rewindEventIds]),
  )
}
