import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Pin } from 'lucide-react-native'
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
        {entry.pinned ? <Icon icon={Pin} color={theme.mutedForeground} size={12} /> : null}
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

export const BucketProjectLabel = ({ name }: { name: string }) => (
  <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1} style={styles.projectLabel}>
    {name}
  </Text>
)

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
  projectLabel: {
    paddingHorizontal: space(2),
    paddingTop: space(1),
  },
})
