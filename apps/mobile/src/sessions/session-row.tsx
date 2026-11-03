import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { relativeTime } from '../lib/relative-time'
import { useTheme } from '../theme/use-theme'
import type { ISessionEntry } from './session-groups'
import { StatusGlyph } from './status-glyph'

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })

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
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: theme.accent } : null]}
    >
      <View style={styles.titleLine}>
        <StatusGlyph status={entry.status} />
        <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>
          {entry.title}
        </Text>
      </View>
      <View style={styles.metaLine}>
        <Text numberOfLines={1} style={[styles.detail, { color: theme.mutedForeground }]}>
          {entry.detail ?? ''}
        </Text>
        <Text style={[styles.time, { color: theme.mutedForeground }]}>
          {relativeTime({ at: entry.updatedAt, now })}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 12,
    gap: 4,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  titleLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  metaLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 30,
  },
  detail: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 13,
  },
  time: {
    fontFamily: MONO,
    fontSize: 13,
  },
})
