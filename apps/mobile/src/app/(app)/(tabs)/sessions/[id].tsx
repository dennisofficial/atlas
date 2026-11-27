import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
  Spinner,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { PanelLeft } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { type LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native'
import { useAuth } from '../../../../auth/auth-provider'
import { KeyboardDock } from '../../../../layout/keyboard-dock'
import { transcriptInsetOf } from '../../../../layout/transcript-inset'
import { useContentWidth } from '../../../../layout/use-content-width'
import { useKeyboard } from '../../../../layout/use-keyboard'
import { usePosture } from '../../../../layout/use-posture'
import { GlassSurface } from '../../../../navigation/glass-surface'
import { EHeaderLeadingItem, sessionHeaderLeadingOf } from '../../../../navigation/header-leading'
import { leadingHeaderOptionsOf } from '../../../../navigation/header-options'
import { SessionsButton } from '../../../../navigation/sessions-button'
import { CommandListSheet } from '../../../../thread/composer/command-list-sheet'
import { Composer } from '../../../../thread/composer/composer'
import { ContextRing } from '../../../../thread/composer/context-ring'
import { StaleCard } from '../../../../thread/composer/stale-card'
import { BlockingStatus } from '../../../../thread/components/blocking-status'
import { useAttachments } from '../../../../thread/composer/use-attachments'
import { usePlanUsage } from '../../../../thread/composer/use-plan-usage'
import { OperatorRequestDock } from '../../../../thread/components/operator-request-card'
import { SessionTitle } from '../../../../thread/components/session-title'
import { StartFailedCard } from '../../../../thread/components/start-failed-card'
import { SessionSkeleton } from '../../../../thread/components/session-skeleton'
import { Transcript } from '../../../../thread/components/transcript'
import { selectedSessionStore } from '../../../../sessions/selected-session'
import { paneWidthOf } from '../../../../sessions/drawer-layout'
import { useSessionsDrawer } from '../../../../sessions/sessions-drawer-state'
import { SessionModelControls } from '../../../../thread/session/session-model-controls'
import { useSessionScreen } from '../../../../thread/session/use-session-screen'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ThreadRow } from '../../../../thread/rows'

const NO_ROWS: readonly ThreadRow[] = []

export default function SessionScreen() {
  const theme = useTheme()
  const posture = usePosture()
  const contentWidth = useContentWidth()
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>()
  const session = useSessionScreen({ sessionId: id, fallbackTitle: title })
  const attachments = useAttachments()
  const { api } = useAuth()
  const model = session.commands.model
  const usage = usePlanUsage({ api, modelRef: model.pinnedRef, working: session.working })
  const { open: drawerOpen, setOpen } = useSessionsDrawer()
  const insets = useSafeAreaInsets()
  const keyboardInset = useKeyboard().inset
  const [dockHeight, setDockHeight] = useState(0)
  const bottomInset = transcriptInsetOf({
    dockHeight,
    keyboardInset,
    safeBottom: insets.bottom,
  })
  const transcriptRows = useMemo(
    () => [...session.rows, ...session.stagedRows],
    [session.rows, session.stagedRows],
  )

  const queuedTurns = useMemo(
    () => ({
      queued: session.queued,
      onEdit: session.withdrawEdit,
      onRemove: session.withdrawRemove,
    }),
    [session.queued, session.withdrawEdit, session.withdrawRemove],
  )

  useFocusEffect(
    useCallback(() => {
      selectedSessionStore().select(id)
    }, [id]),
  )

  const handleOpenSessions = useCallback(() => setOpen(true), [setOpen])

  const handleDockLayout = useCallback((event: LayoutChangeEvent) => {
    setDockHeight(event.nativeEvent.layout.height)
  }, [])

  const handleOpenAgent = useCallback(
    (agentId: string) => {
      router.push(`/agents/${agentId}?sessionId=${id}`)
    },
    [id],
  )

  const showsSessions = sessionHeaderLeadingOf({ posture, drawerOpen }).includes(
    EHeaderLeadingItem.Sessions,
  )
  const placeholder = session.loaded ? undefined : session.failedToLoad ? (
    <View style={styles.center}>
      <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
        This session could not be loaded.
      </Text>
    </View>
  ) : (
    <SessionSkeleton />
  )

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: session.header.title,
          ...leadingHeaderOptionsOf({
            lead: showsSessions ? <SessionsButton onPress={handleOpenSessions} /> : undefined,
            title: <SessionTitle header={session.header} />,
            glassTitle: true,
            fillsBar: true,
            titleButtons: 0,
            barWidth: paneWidthOf({
              listLayout: posture.sessionsList,
              width: contentWidth,
              drawerOpen,
            }),
          }),
          headerBackVisible: false,
          headerLeft:
            showsSessions && Platform.OS !== 'ios'
              ? () => (
                  <Button
                    label="Sessions"
                    icon={PanelLeft}
                    variant={EButtonVariant.Ghost}
                    size={EButtonSize.IconLg}
                    onPress={handleOpenSessions}
                  />
                )
              : undefined,
        }}
      />
      <View style={styles.content}>
        <Transcript
          rows={session.loaded ? transcriptRows : NO_ROWS}
          working={session.loaded && session.turnRunning}
          placeholder={placeholder}
          now={session.now}
          boot={session.loaded ? session.boot : null}
          onRetryBoot={() => void session.retry()}
          threadId={id}
          sessionId={id}
          onLoadOlder={session.loadOlder}
          agentLinks={session.agentLinks}
          sessionNameOf={session.sessionNameOf}
          onOpenAgent={handleOpenAgent}
          bottomInset={bottomInset}
          queued={session.loaded ? queuedTurns : undefined}
          background={session.loaded ? session.background : undefined}
          messageActions={session.messageActions}
        />
        {session.loaded ? (
          <KeyboardDock overlay>
            <View onLayout={handleDockLayout}>
              {session.failure === null || session.startFailure !== undefined ? null : (
                <View style={styles.operator}>
                  <GlassSurface style={styles.failure}>
                    <Text
                      size={ETextRole.Xs}
                      tone={ETextTone.Destructive}
                      style={styles.failureText}
                    >
                      {session.failure}
                    </Text>
                    <Button
                      label="Retry"
                      size={EButtonSize.Sm}
                      variant={EButtonVariant.Outline}
                      onPress={() => void session.retry()}
                    />
                  </GlassSurface>
                </View>
              )}
              <OperatorRequestDock operator={session.operator} />
              {session.stale ? (
                <View style={styles.operator}>
                  <StaleCard />
                </View>
              ) : null}
              {session.stateLine === null ? null : (
                <View style={styles.stateRow}>
                  {session.catchingUp ? <Spinner color={theme.mutedForeground} /> : null}
                  <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.state}>
                    {session.stateLine}
                  </Text>
                  {session.canReconnect ? (
                    <Button
                      label="Reconnect"
                      size={EButtonSize.Sm}
                      variant={EButtonVariant.Ghost}
                      onPress={session.reconnect}
                    />
                  ) : null}
                </View>
              )}
              {session.startFailure === undefined ? null : (
                <StartFailedCard reason={session.startFailure.reason} onRetry={session.retry} />
              )}
              <Composer
                working={session.working}
                attachments={attachments}
                onSend={session.send}
                onStop={session.stop}
                restored={session.restored}
                draftSessionId={id}
                refusal={session.notice}
                entries={session.commands.entries}
                clientActions={session.commands.clientActions}
                status={<BlockingStatus command={session.blocking} now={session.now} />}
                trailing={<ContextRing context={session.context} usage={usage} />}
              >
                <SessionModelControls model={model} />
              </Composer>
            </View>
            <CommandListSheet
              open={session.commands.commandList.open}
              onClose={session.commands.commandList.onClose}
              entries={session.commands.entries}
            />
          </KeyboardDock>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    gap: space(2),
    justifyContent: 'center',
  },
  failure: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    padding: space(2.5),
  },
  failureText: {
    flex: 1,
  },
  operator: {
    paddingBottom: space(2),
    paddingHorizontal: space(3),
  },
  stateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(1.5),
    paddingBottom: space(1),
    paddingHorizontal: space(4),
  },
  state: {
    flexShrink: 1,
  },
})
