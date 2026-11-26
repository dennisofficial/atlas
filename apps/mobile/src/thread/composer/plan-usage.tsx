import {
  EMeterBand,
  formatUtilization,
  planUsageLabelOf,
  planUsageReadingsOf,
} from '@dltech/atlas-core'
import type { UsageReportDto } from '@dltech/atlas-protocol'
import { EFontWeight, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { StyleSheet, View } from 'react-native'

const TONE_OF_BAND: Record<EMeterBand, ETextTone> = {
  [EMeterBand.Unknown]: ETextTone.Muted,
  [EMeterBand.Normal]: ETextTone.Foreground,
  [EMeterBand.Warn]: ETextTone.Warning,
  [EMeterBand.Hot]: ETextTone.Destructive,
  [EMeterBand.Red]: ETextTone.Destructive,
  [EMeterBand.Spent]: ETextTone.Destructive,
}

export const PlanUsage = ({ report }: { report: UsageReportDto | null }) => {
  if (report === null || report.metered === false) return null
  const readings = planUsageReadingsOf(report)
  return (
    <View style={styles.reading}>
      <Text
        accessibilityLabel={planUsageLabelOf(report)}
        size={ETextRole.Sm}
        weight={EFontWeight.Semibold}
        style={styles.value}
      >
        {readings.map((reading, index) => (
          <Text key={reading.kind}>
            {index === 0 ? null : <Text tone={ETextTone.Muted}> · </Text>}
            <Text tone={TONE_OF_BAND[reading.band]}>
              {`${reading.short} ${formatUtilization(reading.utilization)}`}
            </Text>
          </Text>
        ))}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  reading: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  value: {
    fontVariant: ['tabular-nums'],
  },
})
