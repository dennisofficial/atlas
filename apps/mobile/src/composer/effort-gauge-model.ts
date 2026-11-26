export const GAUGE_CENTER = 12
export const GAUGE_RADIUS = 9
export const GAUGE_STROKE_WIDTH = 2.5

const START_DEGREES = 135
const SWEEP_DEGREES = 270
const NEEDLE_RADIUS = 5.5

const round = (value: number): number => Math.round(value * 100) / 100

const pointOf = ({ fraction }: { fraction: number }): readonly [number, number] => {
  const radians = ((START_DEGREES + SWEEP_DEGREES * fraction) * Math.PI) / 180
  return [
    GAUGE_CENTER + GAUGE_RADIUS * Math.cos(radians),
    GAUGE_CENTER + GAUGE_RADIUS * Math.sin(radians),
  ]
}

export const effortFractionOf = ({
  efforts,
  effort,
}: {
  efforts: readonly string[]
  effort: string
}): number => {
  const last = efforts.length - 1
  const index = efforts.indexOf(effort)
  if (last <= 0) return index < 0 ? 0 : 1
  return index < 0 ? 0 : index / last
}

export const effortNeedleDegrees = ({ fraction }: { fraction: number }): number =>
  round(-SWEEP_DEGREES / 2 + SWEEP_DEGREES * fraction)

export const effortArcPath = ({ fraction }: { fraction: number }): string => {
  const [fromX, fromY] = pointOf({ fraction: 0 })
  const [toX, toY] = pointOf({ fraction })
  const large = SWEEP_DEGREES * fraction > 180 ? 1 : 0
  return `M ${round(fromX)} ${round(fromY)} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 ${large} 1 ${round(toX)} ${round(toY)}`
}

export const effortNeedlePath = (): string =>
  `M ${GAUGE_CENTER} ${GAUGE_CENTER} L ${GAUGE_CENTER} ${GAUGE_CENTER - NEEDLE_RADIUS}`
