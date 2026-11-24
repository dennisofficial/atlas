import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { type NativeStackNavigationOptions, router, Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native'

import { usePosture } from '../layout/use-posture'
import { DoneToggle } from './done-toggle'
import { SearchField } from './search-field'
import type { ISessionEntry } from './session-groups'
import { SectionHeader } from './section-header'
import { BucketProjectLabel, SessionRow } from './session-row'
import { EItemKind, sectionsOf } from './session-sections'
import { ELoadState, useSessions } from './use-sessions'

const sessionRouteOf = (entry: ISessionEntry) =>
  ({ pathname: '/sessions/[id]', params: { id: entry.id, title: entry.title } }) as const

const EmptyState = ({ searching }: { searching: boolean }) => (
  <View style={styles.empty}>
    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
      {searching ? 'No matching sessions.' : 'No sessions yet. Tap + to start one.'}
    </Text>
  </View>
)

type TSearchBarOptions = NativeStackNavigationOptions['headerSearchBarOptions']

export const ThreadsHome = ({
  onOpen,
  activeId,
  nativeSearch = false,
}: {
  onOpen?: (entry: ISessionEntry) => void
  activeId?: string
  nativeSearch?: boolean
}) => {
  const theme = useTheme()
  const posture = usePosture()
  const { partition, loadState, refreshing, refresh, now } = useSessions()
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const showsNativeSearch = nativeSearch && Platform.OS === 'ios'
  const searchBarOptions = useMemo<TSearchBarOptions>(
    () => ({
      placeholder: 'Search',
      placement: 'stacked',
      autoCapitalize: 'none',
      hideWhenScrolling: true,
      onChangeText: (event) => setQuery(event.nativeEvent.text),
    }),
    [],
  )
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

  const handleOpen = (entry: ISessionEntry) => {
    if (onOpen === undefined) router.push(sessionRouteOf(entry))
    else onOpen(entry)
  }

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
    <>
      {showsNativeSearch ? (
        <Stack.Screen options={{ headerSearchBarOptions: searchBarOptions }} />
      ) : null}
      <SectionList
        style={{ backgroundColor: theme.sidebar }}
        contentContainerStyle={[
          styles.list,
          {
            paddingRight: space(2),
            paddingBottom: space(8) + posture.clearance.bottom,
          },
        ]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        sections={sections}
        keyExtractor={(item) => item.key}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          showsNativeSearch ? undefined : <SearchField value={query} onChangeText={setQuery} />
        }
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
          <SectionHeader
            section={section}
            onToggle={handleToggle}
            onNewSession={handleNewSession}
          />
        )}
        renderItem={({ item }) => {
          if (item.kind === EItemKind.ProjectLabel) return <BucketProjectLabel name={item.name} />
          if (item.kind === EItemKind.DoneToggle) {
            return (
              <DoneToggle
                count={item.count}
                open={item.open}
                depth={item.depth}
                onPress={() => handleToggle(item.key)}
              />
            )
          }
          return (
            <SessionRow
              entry={item.entry}
              now={now}
              depth={item.depth}
              selected={item.entry.id === activeId}
              onPress={() => handleOpen(item.entry)}
            />
          )
        }}
      />
    </>
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
  },
  empty: {
    alignItems: 'center',
    paddingTop: space(12),
  },
})
