const AT_END_THRESHOLD = 8

export interface EndMetrics {
  scrollOffset: number
  viewportSize: number
  scrollSize: number
}

export function isAtEnd({ scrollOffset, viewportSize, scrollSize }: EndMetrics): boolean {
  return scrollSize - scrollOffset - viewportSize <= AT_END_THRESHOLD
}

export function shouldFollow({ wasAtEnd, scrolledUp }: { wasAtEnd: boolean; scrolledUp: boolean }) {
  return wasAtEnd && !scrolledUp
}
