import { useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { Circle, Svg } from 'react-native-svg'

import { type ContextMeter, contextToneOf, EPopoverTone, ringPercentOf } from './context-reading'

const RING_SIZE = 16
const RING_CENTRE = 8
const RING_RADIUS = 6
const RING_STROKE = 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export const toneColorOf = ({
  tone,
  theme,
}: {
  tone: EPopoverTone
  theme: ReturnType<typeof useTheme>
}): string => {
  if (tone === EPopoverTone.Destructive) return theme.destructive
  if (tone === EPopoverTone.Warning) return theme.warning
  if (tone === EPopoverTone.Muted) return theme.mutedForeground
  return theme.foreground
}

export const ContextRingGlyph = ({ context }: { context: ContextMeter | null }) => {
  const theme = useTheme()
  const percent = ringPercentOf(context)
  const tone = contextToneOf(percent)
  const filled = ((percent ?? 0) / 100) * RING_CIRCUMFERENCE
  return (
    <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 16 16">
      <Circle
        cx={RING_CENTRE}
        cy={RING_CENTRE}
        r={RING_RADIUS}
        fill="none"
        stroke={withAlpha({ color: theme.mutedForeground, alpha: 0.25 })}
        strokeWidth={RING_STROKE}
      />
      {percent === null || percent === 0 ? null : (
        <Circle
          cx={RING_CENTRE}
          cy={RING_CENTRE}
          r={RING_RADIUS}
          fill="none"
          originX={RING_CENTRE}
          originY={RING_CENTRE}
          rotation={-90}
          stroke={toneColorOf({ tone, theme })}
          strokeDasharray={`${filled} ${RING_CIRCUMFERENCE}`}
          strokeLinecap="round"
          strokeWidth={RING_STROKE}
        />
      )}
    </Svg>
  )
}
