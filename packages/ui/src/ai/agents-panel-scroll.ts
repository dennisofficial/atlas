const NEAR_BOTTOM_THRESHOLD = 48

interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isNearBottom({ scrollTop, clientHeight, scrollHeight }: ScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_THRESHOLD
}

interface NextStuckInput extends ScrollMetrics {
  stuck: boolean
  previousTop: number
}

export function nextStuck({ stuck, previousTop, ...metrics }: NextStuckInput): boolean {
  if (isNearBottom(metrics)) return true
  if (metrics.scrollTop < previousTop) return false
  return stuck
}
