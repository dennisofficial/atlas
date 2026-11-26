import { EClientAction } from '@dltech/atlas-commands'
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
import { useCallback, useMemo } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { EffortSelect, FastToggle } from '../../../composer/model-controls'
import { ModelSheet } from '../../../composer/model-picker'
import { ModelTrigger } from '../../../composer/model-trigger'
import { KeyboardDock } from '../../../layout/keyboard-dock'
import { usePosture } from '../../../layout/use-posture'
import { EHeaderLeadingItem, sessionHeaderLeadingOf } from '../../../navigation/header-leading'
import { leadingHeaderOptionsOf } from '../../../navigation/header-options'
import { SessionsButton } from '../../../navigation/sessions-button'
import { CommandListSheet } from '../../../thread/composer/command-list-sheet'
import { Composer } from '../../../thread/composer/composer'
import { ContextReading } from '../../../thread/composer/context-reading'
import { StaleCard } from '../../../thread/composer/stale-card'
import { BlockingStrip } from '../../../thread/components/blocking-strip'
import { useAttachments } from '../../../thread/composer/use-attachments'
import { OperatorRequestDock } from '../../../thread/components/operator-request-card'
import { SessionTitle } from '../../../thread/components/session-title'
import { StartFailedCard } from '../../../thread/components/start-failed-card'
import { SessionSkeleton } from '../../../thread/components/session-skeleton'
import { Transcript } from '../../../thread/components/transcript'
import { selectedSessionStore } from '../../../sessions/selected-session'
import { useSessionsDrawer } from '../../../sessions/sessions-drawer-state'
import { useSessionScreen } from '../../../thread/session/use-session-screen'

export default function SessionScreen() {
  const theme = useTheme()
  const posture = usePosture()
  const { width: windowWidth } = useWindowDimensions()
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>()
  const session = useSessionScreen({ sessionId: id, fallbackTitle: title })
  const attachments = useAttachments()
  const model = session.commands.model
  const { open: drawerOpen, setOpen } = useSessionsDrawer()
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

  const handleOpenAgent = useCallback(
    (agentId: string) => {
      router.push(`/agents/${agentId}?sessionId=${id}`)
    },
    [id],
  )

  const handleOpenModel = session.commands.clientActions[EClientAction.ModelPicker]

  const handleEffort = useCallback(
    (effort: string) => {
      if (model.selection === null) return
      model.onSelect({ ...model.selection, effort })
    },
    [model],
  )

  const handleFast = useCallback(
    (fast: boolean) => {
      if (model.selection === null) return
      model.onSelect({ ...model.selection, fast })
    },
    [model],
  )

  const showsSessions = sessionHeaderLeadingOf({ posture, drawerOpen }).includes(
    EHeaderLeadingItem.Sessions,
  )
  const sessionsHeaderItem = {
    type: 'custom' as const,
    element: <SessionsButton onPress={handleOpenSessions} />,
    hidesSharedBackground: false,
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: session.header.title,
          ...leadingHeaderOptionsOf({
            leading: showsSessions ? [sessionsHeaderItem] : [],
            title: <SessionTitle header={session.header} />,
            titleButtons: showsSessions ? 2 : 1,
            windowWidth,
            posture,
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
        {session.loaded || session.failedToLoad ? null : <SessionSkeleton />}
        {session.failedToLoad ? (
          <View style={styles.center}>
            <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
              This session could not be loaded.
            </Text>
          </View>
        ) : null}
        {session.loaded ? (
          <>
            <Transcript
              rows={transcriptRows}
              working={session.turnRunning}
              now={session.now}
              boot={session.boot}
              onRetryBoot={() => void session.retry()}
              threadId={id}
              sessionId={id}
              onLoadOlder={session.loadOlder}
              agentLinks={session.agentLinks}
              sessionNameOf={session.sessionNameOf}
              onOpenAgent={handleOpenAgent}
              queued={queuedTurns}
            />
            {session.failure === null || session.startFailure !== undefined ? null : (
              <View style={styles.failure}>
                <Text size={ETextRole.Xs} tone={ETextTone.Destructive} style={styles.failureText}>
                  {session.failure}
                </Text>
                <Button
                  label="Retry"
                  size={EButtonSize.Sm}
                  variant={EButtonVariant.Outline}
                  onPress={() => void session.retry()}
                />
              </View>
            )}
            <KeyboardDock>
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
              {session.blocking === undefined ? null : (
                <BlockingStrip command={session.blocking} now={session.now} />
              )}
              <Composer
                working={session.working}
                joined={session.blocking !== undefined}
                attachments={attachments}
                onSend={session.send}
                onStop={session.stop}
                restored={session.restored}
                draftSessionId={id}
                refusal={session.notice}
                entries={session.commands.entries}
                clientActions={session.commands.clientActions}
              >
                <ModelTrigger
                  models={model.models}
                  selection={model.selection}
                  onPress={handleOpenModel}
                />
                {model.selection === null ? null : (
                  <>
                    {model.selection.model.efforts.length === 0 ? null : (
                      <EffortSelect selection={model.selection} onChange={handleEffort} />
                    )}
                    {model.selection.model.fast ? (
                      <FastToggle selection={model.selection} onToggle={handleFast} />
                    ) : null}
                  </>
                )}
                <ContextReading context={session.context} />
              </Composer>
              <CommandListSheet
                open={session.commands.commandList.open}
                onClose={session.commands.commandList.onClose}
                entries={session.commands.entries}
              />
              <ModelSheet {...session.commands.model} />
            </KeyboardDock>
          </>
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
    paddingBottom: space(2),
    paddingHorizontal: space(4),
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
