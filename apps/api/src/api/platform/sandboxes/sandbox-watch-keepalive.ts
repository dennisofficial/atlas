import { EEventsWatchFrame, type EventsWatchFrame } from '@dltech/atlas-wire'

export const POD_WATCH_KEEPALIVE: EventsWatchFrame = { type: EEventsWatchFrame.Keepalive }
export const POD_WATCH_KEEPALIVE_INTERVAL_MS = 30_000

export function keepaliveFrames(
  sink: { push: (frame: EventsWatchFrame) => void },
  intervalMs: number = POD_WATCH_KEEPALIVE_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => sink.push(POD_WATCH_KEEPALIVE), intervalMs)
  return () => clearInterval(timer)
}
