export type InFlightReads = {
  running: (args: { key: string }) => Promise<void> | undefined
  start: (args: { key: string; run: (owned: () => boolean) => Promise<void> }) => Promise<void>
  disown: (args: { key: string }) => void
  clear: () => void
}

/**
 * A read that was in flight when its key left the tracked set must neither publish on landing nor
 * block the key's next read, so each start captures the key's generation and `disown` moves it on.
 */
export function createInFlightReads(): InFlightReads {
  const running = new Map<string, Promise<void>>()
  const generations = new Map<string, number>()
  const generationOf = (key: string): number => generations.get(key) ?? 0

  return {
    running: ({ key }) => running.get(key),
    start: ({ key, run }) => {
      const generation = generationOf(key)
      const owned = (): boolean => generationOf(key) === generation
      const asked = run(owned).finally(() => {
        if (owned()) running.delete(key)
      })
      running.set(key, asked)
      return asked
    },
    disown: ({ key }) => {
      generations.set(key, generationOf(key) + 1)
      running.delete(key)
    },
    clear: () => {
      running.clear()
    },
  }
}
