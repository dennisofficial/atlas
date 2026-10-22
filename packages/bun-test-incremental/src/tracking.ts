let depth = 0

export const isTracking = () => depth === 0

export function untracked<T>(run: () => T): T {
  depth++
  try {
    return run()
  } finally {
    depth--
  }
}
