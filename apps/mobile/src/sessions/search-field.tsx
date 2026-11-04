import { Icon, Input, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Search } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

export const SearchField = ({
  value,
  onChangeText,
}: {
  value: string
  onChangeText: (text: string) => void
}) => {
  const theme = useTheme()
  return (
    <View style={[styles.field, { borderColor: theme.sidebarBorder }]}>
      <Icon icon={Search} color={theme.mutedForeground} size={14} />
      <Input
        bare
        accessibilityLabel="Search sessions"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        placeholder="Search"
        returnKeyType="search"
        value={value}
        onChangeText={onChangeText}
        style={styles.input}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    borderWidth: 1,
    flexDirection: 'row',
    gap: space(2),
    height: 32,
    marginBottom: space(1),
    paddingHorizontal: space(2),
  },
  input: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 0,
  },
})
