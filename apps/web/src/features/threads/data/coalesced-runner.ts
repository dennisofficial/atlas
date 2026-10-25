export function createCoalescedRunner(args: { run: () => Promise<void> }) {
  let stopped = false
  let running = false
  let rerun = false

  const trigger = async (): Promise<void> => {
    if (stopped) return
    if (running) {
      rerun = true
      return
    }
    running = true
    try {
      do {
        rerun = false
        await args.run()
      } while (rerun && !stopped)
    } finally {
      running = false
    }
  }

  return {
    trigger: () => void trigger(),
    stop: () => {
      stopped = true
    },
  }
}
