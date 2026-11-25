import { ESessionDisplay } from '@dltech/atlas-client/stream'
import {
  EFontFamily,
  ETextRole,
  ETextTone,
  Text,
  useIsDark,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space, typeScale } from '@dltech/atlas-ui/tokens'
import { type AccessibilityActionEvent, StyleSheet, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'

import { relativeTime } from '../lib/relative-time'
import type { ISessionEntry } from './session-groups'
import { rowFillOf } from './session-row-fill'
import { ROW_LINE_GAP, ROW_PADDING_Y } from './session-row-layout'
import { rowStatusLabelOf } from './session-status-label'
import { StatusIcon } from './status-icon'
import { WorkSummary } from './work-summary'

const ARCHIVE_ACTION = 'archive'

const STATUS_TONE: Record<ESessionDisplay, ETextTone> = {
  [ESessionDisplay.Starting]: ETextTone.Muted,
  [ESessionDisplay.StartFailed]: ETextTone.Destructive,
  [ESessionDisplay.Working]: ETextTone.Primary,
  [ESessionDisplay.WaitingForYou]: ETextTone.Warning,
  [ESessionDisplay.Idle]: ETextTone.Muted,
  [ESessionDisplay.Parked]: ETextTone.Muted,
  [ESessionDisplay.Failed]: ETextTone.Destructive,
}

const statusToneOf = (status: ESessionDisplay | undefined): ETextTone =>
  status === undefined ? ETextTone.Muted : STATUS_TONE[status]

export const SessionRow = ({
  entry,
  now,
  selected = false,
  archived = false,
  onPress,
  onArchive,
}: {
  entry: ISessionEntry
  now: number
  selected?: boolean
  archived?: boolean
  onPress: () => void
  onArchive?: () => void
}) => {
  const theme = useTheme()
  const dark = useIsDark()
  const status = rowStatusLabelOf(entry.status)
  const fill = rowFillOf({ dark })
  const selectedFill = withAlpha({ color: theme[fill.selected.color], alpha: fill.selected.alpha })
  const pressedFill = withAlpha({ color: theme[fill.pressed.color], alpha: fill.pressed.alpha })
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
        selected ? { backgroundColor: selectedFill } : null,
        selected ? null : pressed ? { backgroundColor: pressedFill } : null,
      ]}
    >
      <View style={styles.primary}>
        <View style={styles.iconSlot}>
          <StatusIcon status={entry.status} unread={entry.unread} />
        </View>
        <Text size={ETextRole.Base} numberOfLines={2} style={styles.title}>
          {entry.title}
        </Text>
      </View>
      <View style={styles.secondary}>
        <View style={styles.details}>
          {status === undefined ? null : (
            <Text size={ETextRole.Xs} tone={statusToneOf(entry.status)} numberOfLines={1}>
              {status}
            </Text>
          )}
          <WorkSummary work={entry.work} />
        </View>
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
    paddingVertical: ROW_PADDING_Y,
  },
  primary: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space(2),
  },
  iconSlot: {
    height: typeScale[ETextRole.Base].lineHeight,
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  secondary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
    marginTop: ROW_LINE_GAP,
  },
  details: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: space(1.5),
    minWidth: 0,
  },
  projectLabel: {
    paddingHorizontal: space(2),
    paddingTop: space(1),
  },
})
