import { EFontWeight, ETextRole, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { EControlsPlacement } from '../layout/posture'
import { usePosture } from '../layout/use-posture'
import { AccountButton } from '../navigation/account-button'
import { NewSessionButton } from '../navigation/new-session-button'
import { SearchField } from './search-field'
import type { ISessionEntry } from './session-groups'
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
  return (
    <View style={[styles.content, { paddingTop: insets.top + space(2) }]}>
      <View style={styles.header}>
        <Text
          size={ETextRole.Lg}
          weight={EFontWeight.Semibold}
          numberOfLines={1}
          style={styles.title}
        >
          Sessions
        </Text>
        <View style={styles.actions}>
          {posture.controls === EControlsPlacement.BottomBar ? <AccountButton /> : null}
          <NewSessionButton />
        </View>
      </View>
      <View style={styles.search}>
        <SearchField value={query} onChangeText={setQuery} />
      </View>
      <View style={styles.list}>
        <SessionsList activeId={activeId} onOpen={onOpen} query={query} />
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
