import type { WireThread } from '@dltech/atlas-wire/web'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { sessionStatusOf } from '../../../sessions/session-status'
import { StatusGlyph } from '../../../sessions/status-glyph'
import { useTheme } from '../../../theme/use-theme'

export default function ThreadScreen() {
  const theme = useTheme()
  const { api } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [thread, setThread] = useState<WireThread | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (api === undefined || id === undefined) return
    api.threads.get
      .query({ threadId: id })
      .then(setThread)
      .catch(() => setFailed(true))
  }, [api, id])

  const title = thread?.title === undefined || thread.title.length === 0 ? 'Untitled' : thread.title

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: thread === null ? '' : title }} />
      {thread === null && !failed ? <ActivityIndicator color={theme.primary} /> : null}
      {failed ? (
        <Text style={{ color: theme.destructive }}>This session could not be loaded.</Text>
      ) : null}
      {thread !== null ? (
        <View style={styles.body}>
          <View style={styles.status}>
            <StatusGlyph status={sessionStatusOf(thread)} />
            <Text numberOfLines={2} style={[styles.title, { color: theme.foreground }]}>
              {title}
            </Text>
          </View>
          <Text style={[styles.note, { color: theme.mutedForeground }]}>
            The transcript view is coming next. Open this session in Atlas on the web or Mac to
            follow it for now.
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  body: {
    gap: 12,
    maxWidth: 420,
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  title: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '600',
  },
  note: {
    fontSize: 15,
    lineHeight: 21,
  },
})
