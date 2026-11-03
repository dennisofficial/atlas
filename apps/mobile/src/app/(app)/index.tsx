import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, View } from 'react-native'

import { SearchField } from '../../sessions/search-field'
import { SectionHeader } from '../../sessions/section-header'
import { SessionRow } from '../../sessions/session-row'
import { sectionsOf } from '../../sessions/session-sections'
import { ELoadState, useSessions } from '../../sessions/use-sessions'

const EmptyState = ({ searching }: { searching: boolean }) => (
  <View style={styles.empty}>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
      {searching ? 'No matching sessions.' : 'No sessions yet. Tap + to start one.'}
    </Text>
  </View>
)

export default function SessionsScreen() {
  const theme = useTheme()
  const { partition, loadState, refreshing, refresh, now } = useSessions()
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const sections = useMemo(
    () => sectionsOf({ partition, query, toggled }),
    [partition, query, toggled],
  )

  const handleToggle = (key: string) =>
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const handleNewSession = (projectId: string) =>
    router.push({ pathname: '/new', params: { project: projectId } })

  if (loadState === ELoadState.Loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.sidebar }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  if (loadState === ELoadState.Failed) {
    return (
      <View style={[styles.center, { backgroundColor: theme.sidebar }]}>
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          Sessions could not be loaded.
        </Text>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} onPress={() => void refresh()}>
          Tap to try again.
        </Text>
      </View>
    )
  }

  const hasSessions = sections.some((section) => section.count > 0)

  return (
    <SectionList
      style={{ backgroundColor: theme.sidebar }}
      contentContainerStyle={styles.list}
      keyboardDismissMode="on-drag"
      sections={sections}
      keyExtractor={(entry) => entry.id}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={<SearchField value={query} onChangeText={setQuery} />}
      ListFooterComponent={
        hasSessions ? undefined : <EmptyState searching={query.trim().length > 0} />
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          tintColor={theme.primary}
        />
      }
      renderSectionHeader={({ section }) => (
        <SectionHeader section={section} onToggle={handleToggle} onNewSession={handleNewSession} />
      )}
      renderItem={({ item }) => (
        <SessionRow
          entry={item}
          now={now}
          onPress={() => router.push({ pathname: '/thread/[id]', params: { id: item.id } })}
        />
      )}
    />
  )
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    flex: 1,
    gap: space(2),
    justifyContent: 'center',
    padding: space(6),
  },
  list: {
    gap: space(0.5),
    padding: space(2),
    paddingBottom: space(8),
  },
  empty: {
    alignItems: 'center',
    paddingTop: space(12),
  },
})
