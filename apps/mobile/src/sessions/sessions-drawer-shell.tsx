import {
  Button,
  EButtonSize,
  EButtonVariant,
  EFontWeight,
  ETextRole,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { PanelLeft } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { usePosture } from '../layout/use-posture'
import { NewSessionButton } from '../navigation/new-session-button'
import { showsHideSessionsButtonOf } from './drawer-layout'
import { SearchField } from './search-field'
import type { ISessionEntry } from './session-groups'
import { useSessionsDrawer } from './sessions-drawer-state'
import { SessionsList } from './sessions-list'

export const SessionsDrawerShell = ({
  activeId,
  onOpen,
}: {
  activeId: string | null
  onOpen: (entry: ISessionEntry) => void
}) => {
  const posture = usePosture()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const { setOpen } = useSessionsDrawer()
  const handleHide = () => setOpen(false)
  return (
    <View style={[styles.content, { paddingTop: insets.top + space(2) }]}>
      <View style={styles.header}>
        {showsHideSessionsButtonOf({ listLayout: posture.sessionsList, selected: activeId }) ? (
          <Button
            label="Hide sessions"
            icon={PanelLeft}
            variant={EButtonVariant.Ghost}
            size={EButtonSize.IconLg}
            onPress={handleHide}
          />
        ) : null}
        <Text
          size={ETextRole.Lg}
          weight={EFontWeight.Semibold}
          numberOfLines={1}
          style={styles.title}
        >
          Sessions
        </Text>
        <View style={styles.actions}>
          <NewSessionButton />
        </View>
      </View>
      <View style={styles.search}>
        <SearchField value={query} onChangeText={setQuery} />
      </View>
      <View style={styles.list}>
        <SessionsList
          activeId={activeId}
          onOpen={onOpen}
          onQueryChange={setQuery}
          query={query}
          showsSearchField={false}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1),
  },
  content: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingBottom: space(1),
    paddingHorizontal: space(2),
  },
  list: {
    flex: 1,
  },
  search: {
    paddingHorizontal: space(2),
  },
  title: {
    flex: 1,
  },
})
