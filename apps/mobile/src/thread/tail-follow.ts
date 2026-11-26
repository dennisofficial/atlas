export const NEAR_BOTTOM_PX = 80

export type TScrollMetrics = {
  contentOffset: { y: number }
  contentSize: { height: number }
  layoutMeasurement: { height: number }
}

export enum EScrollGesture {
  None = 'none',
  Dragging = 'dragging',
  Gliding = 'gliding',
}

export enum EScrollSignal {
  BeginDrag = 'begin-drag',
  EndDrag = 'end-drag',
  BeginMomentum = 'begin-momentum',
  EndMomentum = 'end-momentum',
}

export type TTailFollow = { following: boolean; gesture: EScrollGesture }

export const FOLLOWING_TAIL: TTailFollow = { following: true, gesture: EScrollGesture.None }

export const distanceFromBottom = ({
  contentOffset,
  contentSize,
  layoutMeasurement,
}: TScrollMetrics): number => contentSize.height - (contentOffset.y + layoutMeasurement.height)

export const followsTailAfterUserScroll = (metrics: TScrollMetrics): boolean =>
  distanceFromBottom(metrics) < NEAR_BOTTOM_PX

export const tailFollowAfter = (args: {
  state: TTailFollow
  signal: EScrollSignal
  metrics: TScrollMetrics
}): TTailFollow => {
  const { state, signal, metrics } = args
  if (signal === EScrollSignal.BeginDrag)
    return { following: false, gesture: EScrollGesture.Dragging }
  if (signal === EScrollSignal.BeginMomentum) {
    return { following: false, gesture: EScrollGesture.Gliding }
  }
  if (signal === EScrollSignal.EndDrag) {
    return { following: followsTailAfterUserScroll(metrics), gesture: EScrollGesture.None }
  }
  if (state.gesture !== EScrollGesture.Gliding) return state
  return { following: followsTailAfterUserScroll(metrics), gesture: EScrollGesture.None }
}

export const PIN_SLOP_PX = 1

export type TTailPin = { offset: number; contentHeight: number; viewportHeight: number }

export const pinOffsetOf = ({
  offset,
  contentHeight,
  viewportHeight,
}: TTailPin): number | undefined => {
  const bottom = Math.max(0, contentHeight - viewportHeight)
  return Math.abs(bottom - offset) < PIN_SLOP_PX ? undefined : bottom
}
