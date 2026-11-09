export const FRAME_READY_TIMEOUT_MS = 3_000

export const MAX_FRAME_REMOUNTS = 2

export type FrameWatchdog = { ready: () => void; stop: () => void }

export type FrameScheduler = (run: () => void, ms: number) => () => void

const scheduleTimeout: FrameScheduler = (run, ms) => {
  const handle = setTimeout(run, ms)
  return () => clearTimeout(handle)
}

// A pane webview can be created on a window that never updates, so CEF never creates its browser: the element exists, loadURL is dropped, and nothing ever reports. Rebuilding the element is the only thing that revives it, and only a view that stayed silent is worth rebuilding.
export function watchFrameReady(args: {
  onStalled: () => void
  timeoutMs?: number
  schedule?: FrameScheduler
}): FrameWatchdog {
  const { onStalled, timeoutMs = FRAME_READY_TIMEOUT_MS, schedule = scheduleTimeout } = args
  let alive = false
  let cancelled = false
  const cancel = schedule(() => {
    if (cancelled || alive) return
    onStalled()
  }, timeoutMs)
  return {
    ready: () => {
      alive = true
      cancel()
    },
    stop: () => {
      cancelled = true
      cancel()
    },
  }
}

export const remountAllowedOf = (args: { remounts: number }): boolean =>
  args.remounts < MAX_FRAME_REMOUNTS
