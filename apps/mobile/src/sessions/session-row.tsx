import { EFontFamily, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Pressable, StyleSheet, View } from 'react-native'

import { relativeTime } from '../lib/relative-time'
import type { ISessionEntry } from './session-groups'
import { StatusIcon } from './status-icon'
import { WorkSummary } from './work-summary'

export const SessionRow = ({
  entry,
  now,
  onPress,
}: {
  entry: ISessionEntry
  now: number
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? { backgroundColor: theme.sidebarAccent } : null,
      ]}
    >
      <View style={styles.primary}>
        <StatusIcon status={entry.status} unread={entry.unread} />
        <Text size={ETextRole.Sm} numberOfLines={1} style={styles.title}>
          {entry.title}
        </Text>
      </View>
      <View style={styles.secondary}>
        <WorkSummary work={entry.work} />
        <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
          {relativeTime({ at: entry.updatedAt, now })}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    borderRadius: radius(0.8),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
  },
  primary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  title: {
    flex: 1,
  },
  secondary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
    marginTop: space(1),
  },
})
