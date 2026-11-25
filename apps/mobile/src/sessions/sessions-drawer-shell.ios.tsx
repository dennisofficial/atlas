import { useTheme } from '@dltech/atlas-ui-native'
import { router, usePathname } from 'expo-router'
import { useRef, useState } from 'react'
import { StyleSheet } from 'react-native'
import {
  ScreenStack,
  ScreenStackHeaderSearchBarView,
  ScreenStackItem,
  SearchBar,
  type SearchBarCommands,
} from 'react-native-screens'

import { EControlsPlacement } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import { applyNavigation } from '../navigation/apply-navigation'
import { accountNavigationOf } from '../navigation/root-navigation'
import { drawerBarItemsOf, drawerSearchBarPropsOf, usesNativeSearchOf } from './drawer-header-items'
import {
  emptyDrawerSearchOf,
  searchClearedOf,
  searchDismissedOf,
  searchFocusedOf,
  searchTypedOf,
} from './drawer-search'
import type { ISessionEntry } from './session-groups'
import { SessionsList } from './sessions-list'

type TDrawerScreenProps = {
  activeId: string | null
  onOpen: (entry: ISessionEntry) => void
}

export const SessionsDrawerShell = ({ activeId, onOpen }: TDrawerScreenProps) => {
  const posture = usePosture()
  return (
    <ScreenStack style={styles.stack}>
      <DrawerScreen key={posture.sessionsList} activeId={activeId} onOpen={onOpen} />
    </ScreenStack>
  )
}

const DrawerScreen = ({ activeId, onOpen }: TDrawerScreenProps) => {
  const theme = useTheme()
  const posture = usePosture()
  const pathname = usePathname()
  const searchBarRef = useRef<SearchBarCommands | null>(null)
  const [search, setSearch] = useState(emptyDrawerSearchOf)
  const nativeSearch = usesNativeSearchOf({ listLayout: posture.sessionsList })

  const handleAccount = () =>
    applyNavigation(accountNavigationOf({ controls: posture.controls, pathname }))
  const handleNewSession = () => router.push('/new')
  const handleSearchFocus = () => setSearch(searchFocusedOf)
  const handleSearchText = (text: string) =>
    setSearch((current) => searchTypedOf({ search: current, text }))
  const handleSearchDismiss = () => {
    const dismissed = searchDismissedOf(search)
    if (!dismissed.dismisses) return
    setSearch(dismissed.search)
    searchBarRef.current?.cancelSearch()
  }
  const handleSearchCancel = () => setSearch(searchClearedOf)

  const items = drawerBarItemsOf({
    showsAccount: posture.controls === EControlsPlacement.BottomBar,
    onAccount: handleAccount,
    onNewSession: handleNewSession,
  })

  return (
    <ScreenStackItem
      screenId="sessions-drawer"
      gestureEnabled={false}
      contentStyle={[styles.stack, { backgroundColor: theme.sidebar }]}
      headerConfig={{
        children: nativeSearch ? (
          <ScreenStackHeaderSearchBarView>
            <SearchBar
              ref={searchBarRef}
              {...drawerSearchBarPropsOf()}
              onBlur={handleSearchDismiss}
              onCancelButtonPress={handleSearchCancel}
              onFocus={handleSearchFocus}
              onChangeText={(event) => handleSearchText(event.nativeEvent.text)}
            />
          </ScreenStackHeaderSearchBarView>
        ) : undefined,
        backgroundColor: theme.sidebar,
        color: theme.foreground,
        headerLeftBarButtonItems: items.left,
        headerRightBarButtonItems: items.right,
        hideBackButton: true,
        title: 'Sessions',
        titleColor: theme.foreground,
      }}
    >
      <SessionsList
        activeId={activeId}
        onOpen={onOpen}
        query={search.query}
        showsSearchField={!nativeSearch}
        onQueryChange={handleSearchText}
      />
    </ScreenStackItem>
  )
}

const styles = StyleSheet.create({
  stack: {
    flex: 1,
  },
})
