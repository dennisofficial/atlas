import { useTheme } from '@dltech/atlas-ui-native'
import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import {
  ScreenStack,
  ScreenStackHeaderSearchBarView,
  ScreenStackItem,
  SearchBar,
} from 'react-native-screens'

import { usesGlassHeader } from '../navigation/glass-header'
import { MODEL_SHEET_TITLE, modelSearchBarPropsOf } from './model-search-bar'

export const ModelSheetShell = ({
  query,
  onQueryChange,
  children,
}: {
  query: string
  onQueryChange: (query: string) => void
  children: ReactNode
}) => {
  const theme = useTheme()
  const glass = usesGlassHeader()

  const handleCancel = () => onQueryChange('')

  return (
    <ScreenStack style={styles.stack}>
      <ScreenStackItem
        screenId="model-sheet"
        gestureEnabled={false}
        contentStyle={styles.stack}
        headerConfig={{
          children: (
            <ScreenStackHeaderSearchBarView>
              <SearchBar
                {...modelSearchBarPropsOf()}
                onChangeText={(event) => onQueryChange(event.nativeEvent.text)}
                onCancelButtonPress={handleCancel}
              />
            </ScreenStackHeaderSearchBarView>
          ),
          backgroundColor: glass ? 'transparent' : theme.background,
          color: theme.foreground,
          hideBackButton: true,
          hideShadow: true,
          title: MODEL_SHEET_TITLE,
          titleColor: theme.foreground,
          translucent: glass,
        }}
      >
        {children}
      </ScreenStackItem>
    </ScreenStack>
  )
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
  },
})
