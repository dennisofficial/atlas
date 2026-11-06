const AT_END_THRESHOLD = 8
const USER_INPUT_WINDOW_MS = 500
const DETACHING_KEYS: ReadonlySet<string> = new Set(['PageUp', 'ArrowUp', 'Home'])

export enum EChatFollow {
  Attached = 'attached',
  Detached = 'detached',
}

export enum EFollowEvent {
  UserScrolledUp = 'user-scrolled-up',
  Scrolled = 'scrolled',
  Reattached = 'reattached',
}

export type FollowEvent =
  | { type: EFollowEvent.UserScrolledUp }
  | { type: EFollowEvent.Scrolled; atEnd: boolean; userDriven: boolean }
  | { type: EFollowEvent.Reattached }

export interface EndMetrics {
  scrollOffset: number
  viewportSize: number
  scrollSize: number
}

export function isAtEnd({ scrollOffset, viewportSize, scrollSize }: EndMetrics): boolean {
  return scrollSize - scrollOffset - viewportSize <= AT_END_THRESHOLD
}

export function nextFollow(state: EChatFollow, event: FollowEvent): EChatFollow {
  switch (event.type) {
    case EFollowEvent.UserScrolledUp:
      return EChatFollow.Detached
    case EFollowEvent.Reattached:
      return EChatFollow.Attached
    case EFollowEvent.Scrolled:
      if (state === EChatFollow.Detached && event.atEnd && event.userDriven) {
        return EChatFollow.Attached
      }
      return state
  }
}

export function isUpwardWheel(deltaY: number): boolean {
  return deltaY < 0
}

export function isUpwardTouch({
  previousY,
  currentY,
}: {
  previousY: number
  currentY: number
}): boolean {
  return currentY > previousY
}

export function isDetachingKey(key: string): boolean {
  return DETACHING_KEYS.has(key)
}

export function isUserDriven({
  now,
  lastInputAt,
  pointerHeld,
}: {
  now: number
  lastInputAt: number
  pointerHeld: boolean
}): boolean {
  return pointerHeld || now - lastInputAt <= USER_INPUT_WINDOW_MS
}
