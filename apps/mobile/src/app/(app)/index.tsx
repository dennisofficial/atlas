import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native'

import { SearchField } from '../../sessions/search-field'
import { SectionHeader } from '../../sessions/section-header'
import { SessionRow } from '../../sessions/session-row'
import { ESectionKind, sectionsOf } from '../../sessions/session-sections'
import { ELoadState, useSessions } from '../../sessions/use-sessions'
import { useTheme } from '../../theme/use-theme'

const EmptyState = ({ searching }: { searching: boolean }) => {
  const theme = useTheme()
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: theme.foreground }]}>
        {searching ? 'No matching sessions' : 'No sessions yet'}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.mutedForeground }]}>
        {searching ? 'Try another title or project.' : 'Tap + to start a session.'}
      </Text>
    </View>
  )
}

export default function SessionsScreen() {
  const theme = useTheme()
  const { partition, loadState, refreshing, refresh, now } = useSessions()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<ESectionKind>>(new Set())
  const sections = useMemo(
    () => sectionsOf({ partition, query, expanded }),
    [partition, query, expanded],
  )

  const handleToggle = (kind: ESectionKind) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  if (loadState === ELoadState.Loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }

  if (loadState === ELoadState.Failed) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={{ color: theme.destructive }}>Sessions could not be loaded.</Text>
        <Text style={{ color: theme.mutedForeground }} onPress={() => void refresh()}>
          Tap to try again.
        </Text>
      </View>
    )
  }

  const hasSessions = sections.some((section) => section.count > 0)

  return (
    <SectionList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
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
        <SectionHeader section={section} onToggle={handleToggle} />
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
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
  list: {
    paddingBottom: 32,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptyBody: {
    textAlign: 'center',
  },
})
