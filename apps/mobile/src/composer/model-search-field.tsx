import { Icon, Input, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { CircleX, Search } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'

import { GlassSurface } from '../navigation/glass-surface'

const FIELD_HEIGHT = 44
const ICON_SIZE = 18

export const ModelSearchField = ({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (query: string) => void
}) => {
  const theme = useTheme()

  const handleClear = () => onQueryChange('')

  return (
    <GlassSurface style={styles.field}>
      <Icon icon={Search} color={theme.mutedForeground} size={ICON_SIZE} />
      <Input
        bare
        accessibilityLabel="Search models"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        clearButtonMode="never"
        returnKeyType="search"
        placeholder="Search models"
        value={query}
        onChangeText={onQueryChange}
        style={styles.input}
      />
      {query === '' ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear the search"
          hitSlop={8}
          onPress={handleClear}
        >
          <Icon icon={CircleX} color={theme.mutedForeground} size={ICON_SIZE} />
        </Pressable>
      )}
    </GlassSurface>
  )
}

const styles = StyleSheet.create({
  field: {
    alignItems: 'center',
    borderRadius: FIELD_HEIGHT / 2,
    flexDirection: 'row',
    gap: space(2),
    height: FIELD_HEIGHT,
    marginBottom: space(2),
    marginTop: space(4),
    marginHorizontal: space(3),
    paddingHorizontal: space(3),
  },
  input: {
    flex: 1,
    fontSize: 17,
    height: FIELD_HEIGHT,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
})
