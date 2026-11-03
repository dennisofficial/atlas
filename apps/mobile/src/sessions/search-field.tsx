import { StyleSheet, TextInput, View } from 'react-native'

import { Icon } from '../components/icon'
import { useTheme } from '../theme/use-theme'

export const SearchField = ({
  value,
  onChangeText,
}: {
  value: string
  onChangeText: (text: string) => void
}) => {
  const theme = useTheme()
  return (
    <View style={[styles.field, { borderColor: theme.border, backgroundColor: theme.card }]}>
      <Icon ios="magnifyingglass" web="search" color={theme.mutedForeground} size={17} />
      <TextInput
        accessibilityLabel="Search sessions"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        placeholder="Search"
        placeholderTextColor={theme.mutedForeground}
        returnKeyType="search"
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, { color: theme.foreground }]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
})
