import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'

import { useContentWidth } from '../../../layout/use-content-width'
import { pushedHeaderOptionsOf } from '../../../navigation/header-options'
import { SessionSkeleton } from '../../../thread/components/session-skeleton'
import { Transcript } from '../../../thread/components/transcript'
import type { ThreadRow } from '../../../thread/rows'
import { useAgentScreen } from '../../../thread/session/use-agent-screen'

const NO_ROWS: readonly ThreadRow[] = []

export default function AgentScreen() {
  const theme = useTheme()
  const { agentId, sessionId, title, parentThreadId } = useLocalSearchParams<{
    agentId: string
    sessionId: string
    title?: string
    parentThreadId?: string
  }>()
  const agent = useAgentScreen({ sessionId, agentId, parentThreadId })
  const barWidth = useContentWidth()

  const handleOpenAgent = useCallback(
    (id: string) => {
      router.push(`/agents/${id}?sessionId=${sessionId}&parentThreadId=${agentId}`)
    },
    [sessionId, agentId],
  )

  const placeholder = agent.loaded ? undefined : agent.failedToLoad ? (
    <View style={styles.center}>
      <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
        This sub-agent could not be loaded.
      </Text>
    </View>
  ) : (
    <SessionSkeleton />
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={pushedHeaderOptionsOf({
          title: agent.failedToLoad ? '' : (title ?? agent.title),
          barWidth,
        })}
      />
      <Transcript
        rows={agent.loaded ? agent.rows : NO_ROWS}
        working={agent.loaded && agent.turnRunning}
        placeholder={placeholder}
        now={agent.now}
        threadId={agentId}
        sessionId={sessionId}
        onLoadOlder={agent.loadOlder}
        agentLinks={agent.agentLinks}
        onOpenAgent={handleOpenAgent}
      />
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
