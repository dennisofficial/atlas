import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, View } from 'react-native'

import { usePosture } from '../layout/use-posture'
import { DoneToggle } from './done-toggle'
import { EmptyProjectRow } from './empty-project-row'
import { IndentGuides } from './indent-guides'
import { EListStatus, listStatusOf } from './list-status'
import type { ISessionEntry } from './session-groups'
import { SectionHeader } from './section-header'
import { BucketProjectLabel, SessionRow } from './session-row'
import { LIST_ROW_GAP } from './session-row-layout'
import { EItemKind, sectionsOf } from './session-sections'
import { SearchField } from './search-field'
import { SwipeableSessionRow } from './swipeable-session-row'
import { useArchiveSession } from './use-archive-session'
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
  onQueryChange,
  query,
  showsSearchField,
}: {
  activeId: string | null
  onOpen: (entry: ISessionEntry) => void
  onQueryChange: (text: string) => void
  query: string
  showsSearchField: boolean
}) => {
  const theme = useTheme()
  const posture = usePosture()
  const { partition, loadState, refreshing, refresh, now, setArchiveOverride } = useSessions()
  const { handleArchive, failure } = useArchiveSession({ setArchiveOverride, refresh })
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

  const header = (
    <View style={styles.header}>
      {showsSearchField ? <SearchField value={query} onChangeText={onQueryChange} /> : null}
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
    </View>
  )

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
      keyboardDismissMode={showsSearchField ? 'on-drag' : 'none'}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(item) => item.key}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
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
        if (item.kind === EItemKind.EmptyProject) {
          return <EmptyProjectRow onStartSession={() => handleNewSession(item.projectId)} />
        }
        if (item.kind === EItemKind.DoneToggle) {
          return (
            <IndentGuides depth={item.depth}>
              <DoneToggle
                count={item.count}
                open={item.open}
                onPress={() => handleToggle(item.key)}
              />
            </IndentGuides>
          )
        }
        const archived = item.entry.archivedAt !== null
        const handleRowArchive = () =>
          void handleArchive({ entry: item.entry, archived: !archived })
        return (
          <IndentGuides depth={item.depth}>
            <SwipeableSessionRow archived={archived} onArchive={handleRowArchive}>
              <SessionRow
                entry={item.entry}
                now={now}
                selected={item.entry.id === activeId}
                archived={archived}
                onPress={() => onOpen(item.entry)}
                onArchive={handleRowArchive}
              />
            </SwipeableSessionRow>
          </IndentGuides>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  header: {
    gap: space(1),
  },
  list: {
    gap: LIST_ROW_GAP,
    padding: space(2),
  },
  status: {
    alignItems: 'center',
    gap: space(2),
    paddingTop: space(12),
  },
})
