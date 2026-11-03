import { radius, space } from '@dltech/atlas-ui/tokens'
import { Children, Fragment, type ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'

import { withAlpha } from './color'
import { Separator } from './separator'
import { useTheme } from './use-theme'

export const Card = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

export const CardList = ({ children }: { children: ReactNode }) => {
  const rows = Children.toArray(children)
  return (
    <Card style={styles.list}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <Separator /> : null}
          {row}
        </Fragment>
      ))}
    </Card>
  )
}

export const CardRow = ({ children }: { children: ReactNode }) => (
  <View style={styles.row}>{children}</View>
)

const styles = StyleSheet.create({
  card: {
    borderRadius: radius(1.4),
    borderWidth: 1,
    gap: space(4),
    overflow: 'hidden',
    padding: space(4),
  },
  list: {
    gap: 0,
    padding: 0,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(3),
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
  },
})
