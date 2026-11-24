import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'

import { SessionSkeleton } from '../../../thread/components/session-skeleton'
import { Transcript } from '../../../thread/components/transcript'
import { useV2AgentScreen } from '../../../thread/v2/use-v2-agent-screen'

export default function AgentScreen() {
  const theme = useTheme()
  const { agentId, sessionId, title, parentThreadId } = useLocalSearchParams<{
    agentId: string
    sessionId: string
    title?: string
    parentThreadId?: string
  }>()
  const agent = useV2AgentScreen({ sessionId, agentId, parentThreadId })

  const handleOpenAgent = useCallback(
    (id: string) => {
      router.push(`/agents/${id}?sessionId=${sessionId}&parentThreadId=${agentId}`)
    },
    [sessionId, agentId],
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: agent.failedToLoad ? '' : (title ?? agent.title) }} />
      {agent.loaded || agent.failedToLoad ? null : <SessionSkeleton />}
      {agent.failedToLoad ? (
        <View style={styles.center}>
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            This sub-agent could not be loaded.
          </Text>
        </View>
      ) : null}
      {agent.loaded ? (
        <Transcript
          rows={agent.rows}
          working={agent.turnRunning}
          now={agent.now}
          threadId={agentId}
          sessionId={sessionId}
          onLoadOlder={agent.loadOlder}
          agentLinks={agent.agentLinks}
          onOpenAgent={handleOpenAgent}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: space(2),
    justifyContent: 'center',
  },
})
