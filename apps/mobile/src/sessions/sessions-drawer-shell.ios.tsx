import { useTheme } from '@dltech/atlas-ui-native'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import {
  ScreenStack,
  ScreenStackHeaderLeftView,
  ScreenStackHeaderSearchBarView,
  ScreenStackItem,
  SearchBar,
  type SearchBarCommands,
} from 'react-native-screens'

import { usePosture } from '../layout/use-posture'
import { AccountButton } from '../navigation/account-button'
import { usesGlassHeader } from '../navigation/glass-header'
import { TabHeaderTitle } from '../navigation/header-options'
import {
  drawerBarItemsOf,
  drawerSearchBarPropsOf,
  showsAccountViewOf,
  usesNativeSearchOf,
} from './drawer-header-items'
import { drawerHidableOf } from './drawer-layout'
import {
  emptyDrawerSearchOf,
  searchClearedOf,
  searchDismissedOf,
  searchFocusedOf,
  searchTypedOf,
} from './drawer-search'
import type { ISessionEntry } from './session-groups'
import { useSessionsDrawer } from './sessions-drawer-state'
import { SessionsList } from './sessions-list'

type TDrawerScreenProps = {
  activeId: string | null
  onOpen: (entry: ISessionEntry) => void
}

const SESSIONS_TITLE = 'Sessions'

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
  const searchBarRef = useRef<SearchBarCommands | null>(null)
  const [search, setSearch] = useState(emptyDrawerSearchOf)
  const nativeSearch = usesNativeSearchOf({ listLayout: posture.sessionsList })
  const showsAccount = showsAccountViewOf({ controls: posture.controls })
  const { setOpen } = useSessionsDrawer()
  const hidable = drawerHidableOf({ listLayout: posture.sessionsList, selected: activeId })
  const glass = usesGlassHeader()

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

  const handleHide = () => setOpen(false)

  const items = drawerBarItemsOf({
    onNewSession: handleNewSession,
    onHide: hidable ? handleHide : undefined,
  })

  return (
    <ScreenStackItem
      screenId="sessions-drawer"
      gestureEnabled={false}
      contentStyle={[styles.stack, { backgroundColor: theme.sidebar }]}
      headerConfig={{
        children: (
          <>
            {showsAccount ? (
              <ScreenStackHeaderLeftView>
                <AccountButton />
              </ScreenStackHeaderLeftView>
            ) : null}
            {glass ? (
              <ScreenStackHeaderLeftView hidesSharedBackground={false}>
                <View style={styles.glassTitle}>
                  <TabHeaderTitle title={SESSIONS_TITLE} />
                </View>
              </ScreenStackHeaderLeftView>
            ) : null}
            {nativeSearch ? (
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
            ) : null}
          </>
        ),
        backgroundColor: glass ? 'transparent' : theme.sidebar,
        color: theme.foreground,
        headerRightBarButtonItems: items.right,
        hideBackButton: true,
        hideShadow: glass,
        title: glass ? '' : SESSIONS_TITLE,
        titleColor: theme.foreground,
        translucent: glass,
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
  glassTitle: {
    paddingHorizontal: 12,
  },
  stack: {
    flex: 1,
  },
})
