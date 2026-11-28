import {
  formatMemoryDate,
  MEMORY_TYPE_LABELS,
  type MemoryEntry,
} from '@dltech/atlas-client/settings'
import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { ChevronRight, Circle, CircleCheck } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

export const MemoryRowView = ({
  entry,
  selecting,
  selected,
  disabled,
  onPress,
}: {
  entry: MemoryEntry
  selecting: boolean
  selected: boolean
  disabled: boolean
  onPress: (entry: MemoryEntry) => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityLabel={entry.name}
      accessibilityState={{ checked: selecting ? selected : undefined, disabled }}
      aria-checked={selecting ? selected : undefined}
      disabled={disabled}
      onPress={() => onPress(entry)}
    >
      <View style={styles.row}>
        {selecting ? (
          <View style={styles.selection}>
            <Icon icon={selected ? CircleCheck : Circle} color={theme.primary} size={20} />
          </View>
        ) : null}
        <View style={styles.rowText}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {MEMORY_TYPE_LABELS[entry.type]}
          </Text>
          <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
            {entry.name}
          </Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={2}>
            {entry.description}
          </Text>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {`rev ${entry.revision} · updated ${formatMemoryDate(entry.updatedAt)}`}
          </Text>
        </View>
        {selecting ? null : <Icon icon={ChevronRight} color={theme.mutedForeground} size={16} />}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  selection: { width: 20, flexShrink: 0 },
  rowText: {
    flexShrink: 1,
    gap: space(1),
  },
})
