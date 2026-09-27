/**
 * A step that ignores its abort signal must not hang teardown forever — SIGTERM has its own
 * deadline from the platform, and drifting past it is a hard kill rather than a clean exit.
 */
export const DEFAULT_DRAIN_DEADLINE_MS = 10_000

export const withDeadline = async (args: { task: Promise<void>; ms: number }): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, args.ms)
  })
  try {
    await Promise.race([args.task, timedOut])
  } finally {
    clearTimeout(timer)
  }
}
