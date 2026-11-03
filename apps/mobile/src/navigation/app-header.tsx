import { EFontWeight, ETextRole, Text, useTheme } from '@dltech/atlas-ui-native'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export const AppHeader = ({
  title,
  left,
  right,
  surface,
}: {
  title: ReactNode
  left?: ReactNode
  right?: ReactNode
  surface: string
}) => {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, backgroundColor: surface, borderBottomColor: theme.border },
      ]}
    >
      <View style={styles.bar}>
        {left}
        {typeof title === 'string' ? (
          <Text
            size={ETextRole.Sm}
            weight={EFontWeight.Medium}
            numberOfLines={1}
            style={styles.title}
          >
            {title}
          </Text>
        ) : (
          title
        )}
        <View style={styles.right}>{right}</View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: 48,
    paddingHorizontal: 8,
  },
  title: {
    flexShrink: 1,
    paddingHorizontal: 4,
  },
  right: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginLeft: 'auto',
  },
})
