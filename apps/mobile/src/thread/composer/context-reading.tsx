import { contextPercentOf } from '@dltech/atlas-client/session'
import {
  EFontWeight,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { StyleSheet, View } from 'react-native'
import { Circle, Svg } from 'react-native-svg'

export type ContextMeter = {
  used: number | null
  window: number | null
}

const RING_SIZE = 16
const RING_CENTRE = 8
const RING_RADIUS = 6
const RING_STROKE = 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const WARN_PERCENT = 70
const DANGER_PERCENT = 90

const BANDS: readonly { at: number; tone: ETextTone }[] = [
  { at: DANGER_PERCENT, tone: ETextTone.Destructive },
  { at: WARN_PERCENT, tone: ETextTone.Warning },
]

const toneOf = (percent: number | null): ETextTone =>
  percent === null
    ? ETextTone.Muted
    : (BANDS.find((band) => percent >= band.at)?.tone ?? ETextTone.Foreground)

const strokeOfTone = ({
  tone,
  theme,
}: {
  tone: ETextTone
  theme: ReturnType<typeof useTheme>
}): string => {
  if (tone === ETextTone.Destructive) return theme.destructive
  if (tone === ETextTone.Warning) return theme.warning
  if (tone === ETextTone.Muted) return theme.mutedForeground
  return theme.foreground
}

export const ContextReading = ({ context }: { context: ContextMeter | null }) => {
  const theme = useTheme()
  const percent =
    context === null ? null : contextPercentOf({ used: context.used, window: context.window })
  const tone = toneOf(percent)
  const filled = ((percent ?? 0) / 100) * RING_CIRCUMFERENCE
  return (
    <View style={styles.reading}>
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
            stroke={strokeOfTone({ tone, theme })}
            strokeDasharray={`${filled} ${RING_CIRCUMFERENCE}`}
            strokeLinecap="round"
            strokeWidth={RING_STROKE}
          />
        )}
      </Svg>
      <Text
        accessibilityLabel={percent === null ? 'Context not measured yet' : `Context ${percent}%`}
        size={ETextRole.Sm}
        tone={tone}
        weight={EFontWeight.Semibold}
        style={styles.value}
      >
        {percent === null ? '—' : `${percent}%`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  reading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1),
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
})
