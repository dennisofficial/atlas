export type ExpectingWindows = {
  arm: (args: { key: string }) => void
  untilOf: (args: { key: string }) => number | null
  forget: (args: { key: string }) => void
  clear: () => void
}

export function createExpectingWindows(args: {
  now: () => number
  windowMs: number
}): ExpectingWindows {
  const until = new Map<string, number>()

  return {
    arm: ({ key }) => {
      const at = args.now()
      for (const [held, expires] of until) {
        if (expires <= at) until.delete(held)
      }
      until.set(key, at + args.windowMs)
    },
    untilOf: ({ key }) => until.get(key) ?? null,
    forget: ({ key }) => {
      until.delete(key)
    },
    clear: () => {
      until.clear()
    },
  }
}
