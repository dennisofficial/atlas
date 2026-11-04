import { EFontWeight, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { WireThread } from '@dltech/atlas-wire/web'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { isUnread, sessionStatusOf } from '../../../sessions/session-status'
import { StatusIcon } from '../../../sessions/status-icon'

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
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          This session could not be loaded.
        </Text>
      ) : null}
      {thread !== null ? (
        <View style={styles.body}>
          <View style={styles.status}>
            <StatusIcon status={sessionStatusOf(thread)} unread={isUnread(thread)} />
            <Text
              size={ETextRole.Lg}
              weight={EFontWeight.Medium}
              tight
              numberOfLines={2}
              style={styles.title}
            >
              {title}
            </Text>
          </View>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
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
    padding: space(6),
  },
  body: {
    gap: space(3),
    maxWidth: 420,
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  title: {
    flexShrink: 1,
  },
})
