import { useTheme } from '@dltech/atlas-ui-native'
import { router, usePathname } from 'expo-router'
import { useState } from 'react'
import { StyleSheet } from 'react-native'
import {
  ScreenStack,
  ScreenStackHeaderSearchBarView,
  ScreenStackItem,
  SearchBar,
} from 'react-native-screens'

import { EControlsPlacement } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import { applyNavigation } from '../navigation/apply-navigation'
import { accountNavigationOf } from '../navigation/root-navigation'
import {
  drawerBarItemsOf,
  drawerSearchBarPropsOf,
  showsNewSessionButtonOf,
} from './drawer-header-items'
import type { ISessionEntry } from './session-groups'
import { SessionsList } from './sessions-list'

export const SessionsDrawerShell = ({
  activeId,
  onOpen,
}: {
  activeId: string | null
  onOpen: (entry: ISessionEntry) => void
}) => {
  const theme = useTheme()
  const posture = usePosture()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)

  const handleAccount = () =>
    applyNavigation(accountNavigationOf({ controls: posture.controls, pathname }))
  const handleNewSession = () => router.push('/new')
  const handleSearchText = (text: string) => setQuery(text)
  const handleSearchFocus = () => setSearching(true)
  const handleSearchBlur = () => setSearching(false)

  const items = drawerBarItemsOf({
    showsAccount: posture.controls === EControlsPlacement.BottomBar,
    showsNewSession: showsNewSessionButtonOf({
      listLayout: posture.sessionsList,
      searching,
    }),
    onAccount: handleAccount,
    onNewSession: handleNewSession,
  })

  return (
    <ScreenStack style={styles.stack}>
      <ScreenStackItem
        screenId="sessions-drawer"
        gestureEnabled={false}
        contentStyle={[styles.stack, { backgroundColor: theme.sidebar }]}
        headerConfig={{
          children: (
            <ScreenStackHeaderSearchBarView>
              <SearchBar
                {...drawerSearchBarPropsOf()}
                onBlur={handleSearchBlur}
                onChangeText={(event) => handleSearchText(event.nativeEvent.text)}
                onFocus={handleSearchFocus}
              />
            </ScreenStackHeaderSearchBarView>
          ),
          backgroundColor: theme.sidebar,
          color: theme.foreground,
          headerLeftBarButtonItems: items.left,
          headerRightBarButtonItems: items.right,
          hideBackButton: true,
          title: 'Sessions',
          titleColor: theme.foreground,
        }}
      >
        <SessionsList activeId={activeId} onOpen={onOpen} query={query} />
      </ScreenStackItem>
    </ScreenStack>
  )
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
  },
})
