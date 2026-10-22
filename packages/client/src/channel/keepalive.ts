export type Keepalive = { intervalMs: number; run: () => void }

export type ScheduleKeepalive = (keepalive: Keepalive) => () => void

/**
 * The Vercel edge in front of a sandbox kills a WebSocket carrying no frames at ~340s with code
 * 1006. A ping every 30s keeps the socket carrying traffic well inside that window.
 */
export const DEFAULT_KEEPALIVE_MS = 30_000

export const intervalKeepaliveScheduler: ScheduleKeepalive = ({ intervalMs, run }) => {
  const handle = setInterval(run, intervalMs)
  return () => clearInterval(handle)
}
