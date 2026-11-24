export const NEAR_BOTTOM_PX = 80

export type TScrollMetrics = {
  contentOffset: { y: number }
  contentSize: { height: number }
  layoutMeasurement: { height: number }
}

export const distanceFromBottom = ({
  contentOffset,
  contentSize,
  layoutMeasurement,
}: TScrollMetrics): number => contentSize.height - (contentOffset.y + layoutMeasurement.height)

export const followsTailAfterUserScroll = (metrics: TScrollMetrics): boolean =>
  distanceFromBottom(metrics) < NEAR_BOTTOM_PX
