import { EFontFamily, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { type AccessibilityActionEvent, StyleSheet, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'

import { relativeTime } from '../lib/relative-time'
import type { ISessionEntry } from './session-groups'
import { sessionStatusLabelOf } from './session-status-label'
import { StatusIcon } from './status-icon'
import { WorkSummary } from './work-summary'

const ARCHIVE_ACTION = 'archive'

export const SessionRow = ({
  entry,
  now,
  depth = 0,
  selected = false,
  archived = false,
  onPress,
  onArchive,
}: {
  entry: ISessionEntry
  now: number
  depth?: number
  selected?: boolean
  archived?: boolean
  onPress: () => void
  onArchive?: () => void
}) => {
  const theme = useTheme()
  const status = sessionStatusLabelOf(entry.status)
  const handleAccessibilityAction = ({ nativeEvent }: AccessibilityActionEvent) => {
    if (onArchive === undefined || nativeEvent.actionName !== ARCHIVE_ACTION) return
    onArchive()
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityActions={
        onArchive === undefined
          ? undefined
          : [{ name: ARCHIVE_ACTION, label: archived ? 'Unarchive' : 'Archive' }]
      }
      onAccessibilityAction={handleAccessibilityAction}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? { backgroundColor: theme.sidebarAccent } : null,
        depth > 0 ? { paddingLeft: space(2) + depth * space(4) } : null,
        pressed ? { backgroundColor: theme.sidebarAccent } : null,
      ]}
    >
      <View style={styles.primary}>
        <StatusIcon status={entry.status} unread={entry.unread} />
        <Text size={ETextRole.Base} numberOfLines={2} style={styles.title}>
          {entry.title}
        </Text>
      </View>
      <View style={styles.secondary}>
        {status === undefined ? null : (
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1} style={styles.status}>
            {status}
          </Text>
        )}
        <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
          {relativeTime({ at: entry.updatedAt, now })}
        </Text>
      </View>
      <WorkSummary work={entry.work} />
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
    minHeight: 64,
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
    justifyContent: 'space-between',
    marginTop: space(0.5),
  },
  status: {
    flex: 1,
  },
  projectLabel: {
    paddingHorizontal: space(2),
    paddingTop: space(1),
  },
})
