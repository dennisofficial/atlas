import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, View } from 'react-native'

import { usePosture } from '../layout/use-posture'
import { DoneToggle } from './done-toggle'
import { EListStatus, listStatusOf } from './list-status'
import { SearchField } from './search-field'
import type { ISessionEntry } from './session-groups'
import { SectionHeader } from './section-header'
import { BucketProjectLabel, SessionRow } from './session-row'
import { EItemKind, sectionsOf } from './session-sections'
import { ELoadState, useSessions } from './use-sessions'

const handleNewSession = (projectId: string) =>
  router.push({ pathname: '/new', params: { project: projectId } })

const ListStatusView = ({ status, onRetry }: { status: EListStatus; onRetry: () => void }) => {
  const theme = useTheme()
  if (status === EListStatus.Ready) return null
  if (status === EListStatus.Loading) {
    return (
      <View style={styles.status}>
        <ActivityIndicator color={theme.primary} />
      </View>
    )
  }
  if (status === EListStatus.Failed) {
    return (
      <View style={styles.status}>
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          Sessions could not be loaded.
        </Text>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} onPress={onRetry}>
          Tap to try again.
        </Text>
      </View>
    )
  }
  return (
    <View style={styles.status}>
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {status === EListStatus.NoMatches
          ? 'No matching sessions.'
          : 'No sessions yet. Tap + to start one.'}
      </Text>
    </View>
  )
}

export const SessionsList = ({
  activeId,
  onOpen,
}: {
  activeId: string | null
  onOpen: (entry: ISessionEntry) => void
}) => {
  const theme = useTheme()
  const posture = usePosture()
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

  const status = listStatusOf({
    loading: loadState === ELoadState.Loading,
    failed: loadState === ELoadState.Failed,
    hasSessions: sections.some((section) => section.count > 0),
    searching: query.trim().length > 0,
  })

  return (
    <SectionList
      style={{ backgroundColor: theme.sidebar }}
      contentContainerStyle={[
        styles.list,
        {
          paddingRight: space(2),
          paddingBottom: space(8) + posture.clearance.bottom,
        },
      ]}
      keyboardDismissMode="on-drag"
      sections={sections}
      keyExtractor={(item) => item.key}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={<SearchField value={query} onChangeText={setQuery} />}
      ListFooterComponent={<ListStatusView status={status} onRetry={() => void refresh()} />}
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
            onPress={() => onOpen(item.entry)}
          />
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  list: {
    gap: space(0.5),
    padding: space(2),
  },
  status: {
    alignItems: 'center',
    gap: space(2),
    paddingTop: space(12),
  },
})
