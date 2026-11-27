import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { ModelSearchField } from './model-picker'

export const ModelSheetShell = ({
  query,
  onQueryChange,
  children,
}: {
  query: string
  onQueryChange: (query: string) => void
  children: ReactNode
}) => (
  <View style={styles.shell}>
    <ModelSearchField query={query} onQueryChange={onQueryChange} />
    {children}
  </View>
)

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    paddingTop: 12,
  },
})
