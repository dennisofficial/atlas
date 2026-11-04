import { StyleSheet, View } from 'react-native'

import { useTheme } from './use-theme'

export const Separator = ({ sidebar = false }: { sidebar?: boolean }) => {
  const theme = useTheme()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        alignSelf: 'stretch',
        backgroundColor: sidebar ? theme.sidebarBorder : theme.border,
      }}
    />
  )
}

export const Rule = () => {
  const theme = useTheme()
  return (
    <View
      style={{
        flex: 1,
        minWidth: 12,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.sidebarBorder,
      }}
    />
  )
}
