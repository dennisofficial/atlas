import { track } from './analytics'
import {
  elapsedMs,
  navigationMetrics,
  type NavigationMetrics,
  type NavigationTimingLike,
} from './perf'

const SIDEBAR_FALLBACK_MS = 5000

let metrics: NavigationMetrics | undefined
let navigationStart = 0
let sidebarReadyAt: number | undefined
let sent = false
let fallback: ReturnType<typeof setTimeout> | undefined

function send(): void {
  if (sent || metrics === undefined) return
  sent = true
  if (fallback !== undefined) {
    clearTimeout(fallback)
    fallback = undefined
  }
  const props: Record<string, unknown> = { ...metrics }
  if (sidebarReadyAt !== undefined) {
    props.first_sidebar_ms = elapsedMs({ from: navigationStart, to: sidebarReadyAt })
  }
  track('app_loaded', props)
}

export function recordPageLoad(timing: NavigationTimingLike): void {
  if (sent || metrics !== undefined) return
  metrics = navigationMetrics(timing)
  navigationStart = timing.startTime
  if (sidebarReadyAt !== undefined) {
    send()
    return
  }
  fallback = setTimeout(send, SIDEBAR_FALLBACK_MS)
}

export function markSidebarReady(at = performance.now()): void {
  if (sent || sidebarReadyAt !== undefined) return
  sidebarReadyAt = at
  if (metrics !== undefined) send()
}

export function resetAppLoadForTests(): void {
  if (fallback !== undefined) clearTimeout(fallback)
  metrics = undefined
  navigationStart = 0
  sidebarReadyAt = undefined
  sent = false
  fallback = undefined
}
