import { Path, Svg } from 'react-native-svg'

import {
  effortArcPath,
  effortFractionOf,
  effortNeedleDegrees,
  effortNeedlePath,
  GAUGE_CENTER,
  GAUGE_STROKE_WIDTH,
} from './effort-gauge-model'

const TRACK_PATH = effortArcPath({ fraction: 1 })
const NEEDLE_PATH = effortNeedlePath()
const GAUGE_SIZE = 20

export const EffortGauge = ({
  efforts,
  effort,
  color,
}: {
  efforts: readonly string[]
  effort: string
  color: string
}) => {
  const degrees = effortNeedleDegrees({ fraction: effortFractionOf({ efforts, effort }) })
  return (
    <Svg width={GAUGE_SIZE} height={GAUGE_SIZE} viewBox="0 0 24 24">
      <Path
        d={TRACK_PATH}
        fill="none"
        stroke={color}
        strokeWidth={GAUGE_STROKE_WIDTH}
        strokeLinecap="round"
      />
      <Path
        d={NEEDLE_PATH}
        fill="none"
        stroke={color}
        strokeWidth={GAUGE_STROKE_WIDTH}
        strokeLinecap="round"
        transform={`rotate(${degrees} ${GAUGE_CENTER} ${GAUGE_CENTER})`}
      />
    </Svg>
  )
}
