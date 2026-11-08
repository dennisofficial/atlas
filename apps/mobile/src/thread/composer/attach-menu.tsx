import { ETextRole, EFontWeight, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { FileText, ImagePlus, type LucideIcon } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

const Option = ({
  icon: Glyph,
  label,
  onPress,
}: {
  icon: LucideIcon
  label: string
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: pressed
            ? withAlpha({ color: theme.foreground, alpha: 0.06 })
            : 'transparent',
        },
      ]}
    >
      <Glyph size={18} color={theme.foreground} />
      <Text size={ETextRole.Sm} weight={EFontWeight.Medium}>
        {label}
      </Text>
    </Pressable>
  )
}

export const AttachMenu = ({ onPhoto, onFile }: { onPhoto: () => void; onFile: () => void }) => {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.menu,
        {
          backgroundColor: theme.card,
          borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
        },
      ]}
    >
      <Option icon={ImagePlus} label="Photo library" onPress={onPhoto} />
      <Option icon={FileText} label="Choose a file" onPress={onFile} />
    </View>
  )
}

const styles = StyleSheet.create({
  menu: {
    alignSelf: 'flex-start',
    borderRadius: radius(1.2),
    borderWidth: 1,
    gap: space(0.5),
    marginBottom: space(2),
    marginLeft: space(1),
    padding: space(1),
  },
  option: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
})
