import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../../auth/auth-provider'
import { relativeTime } from '../../lib/relative-time'
import { listSessions, type ISessionEntry } from '../../sessions/sessions-list'
import { useTheme } from '../../theme/use-theme'

enum ELoadState {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export default function SessionsScreen() {
  const theme = useTheme()
  const { api } = useAuth()
  const [entries, setEntries] = useState<ISessionEntry[]>([])
  const [loadState, setLoadState] = useState(ELoadState.Loading)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    if (api === undefined) return
    try {
      const result = await listSessions({ api })
      setEntries(result)
      setLoadState(ELoadState.Ready)
      setNow(Date.now())
    } catch {
      setLoadState(ELoadState.Failed)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

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
        <Text style={{ color: theme.mutedForeground }}>Pull down to try again.</Text>
      </View>
    )
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={entries.length === 0 ? styles.center : styles.list}
      data={entries}
      keyExtractor={(entry) => entry.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
          tintColor={theme.primary}
        />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.foreground }]}>No sessions yet</Text>
          <Text style={{ color: theme.mutedForeground }}>
            Start a session in Atlas and it will show up here.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.row, { borderBottomColor: theme.border }]}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>
            {item.title}
          </Text>
          <Text style={[styles.rowTime, { color: theme.mutedForeground }]}>
            {relativeTime({ at: item.updatedAt, now })}
          </Text>
        </View>
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
    paddingVertical: 8,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  rowTime: {
    fontSize: 13,
  },
})
