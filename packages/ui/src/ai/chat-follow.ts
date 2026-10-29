const AT_END_THRESHOLD = 8
const DOWNWARD_KEYS = new Set(['ArrowDown', 'End', 'PageDown', ' '])

interface EndMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isAtEnd({ scrollTop, clientHeight, scrollHeight }: EndMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= AT_END_THRESHOLD
}

export function isDownwardWheel(deltaY: number): boolean {
  return deltaY > 0
}

export function isDownwardKey(key: string): boolean {
  return DOWNWARD_KEYS.has(key)
}
