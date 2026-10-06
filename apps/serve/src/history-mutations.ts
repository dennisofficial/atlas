export function createHistoryMutations() {
  let inFlight = 0
  return {
    assertAvailable(): void {
      if (inFlight > 0) throw new Error('a history mutation is in flight — wait before summarising')
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      inFlight += 1
      try {
        return await task()
      } finally {
        inFlight -= 1
      }
    },
  }
}
