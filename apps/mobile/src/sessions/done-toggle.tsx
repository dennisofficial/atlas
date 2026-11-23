import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

export const DoneToggle = ({
  count,
  open,
  depth,
  onPress,
}: {
  count: number
  open: boolean
  depth: number
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Done, ${count} ${count === 1 ? 'teammate' : 'teammates'}`}
      accessibilityState={{ expanded: open }}
      hitSlop={{ top: space(1.5), bottom: space(1.5) }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        depth > 0 ? { paddingLeft: space(2) + depth * space(4) } : null,
        pressed ? { backgroundColor: theme.sidebarAccent } : null,
      ]}
    >
      <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
        <Icon icon={ChevronRight} color={theme.mutedForeground} size={14} />
      </View>
      <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.label}>
        Done
      </Text>
      <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
        {count}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(1.5),
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
  },
  label: {
    flex: 1,
  },
})
