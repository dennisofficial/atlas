'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ESessionStatus } from '@dltech/atlas-core'
import { liveBackgroundOf } from '@dltech/atlas-client/crew'
import { ESessionConnection } from '@dltech/atlas-client/stream'

import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { messageOf } from '@/features/threads/data/use-send'
import { ThreadPanelProvider } from '@/features/threads/panel/thread-panel-context'
import { useComposerAttachments } from '@/features/threads/data/use-composer-attachments'
import { ModelPickerControls } from '@/features/threads/model-picker'
import { ThreadComposer } from '@/features/threads/thread-composer'
import { ThreadTranscript } from '@/features/threads/thread-transcript'
import { turnStartedAtOf } from '@/features/threads/data/turn-start'
import { SummariseDialog } from '@/features/threads/transcript/summarise-dialog'
import { RewindDialog } from '@/features/threads/transcript/rewind-dialog'
import { track } from '@/lib/analytics/analytics'
import { sessionOpenedProps } from '@/lib/analytics/perf'

import { attachmentsOf } from '@dltech/atlas-core'

import { useSessionAgentWiring } from './data/use-session-agent-wiring'
import { postInputOf } from './data/session-media'
import { sessionsApi } from './data/sessions-api'
import { stopSession } from './data/stop-session'
import { headerStateOfSession, isSessionWorking } from './data/session-state'
import { sessionLog, sessionStream } from './data/session-stream'
import { mergedDraftOf } from './data/session-rewind'
import { useSessionRewind } from './data/use-session-rewind'
import { sessionRefusalsOf } from './data/session-refusals'
import { sessionBootViewOf } from './data/session-boot-view'
import { sessionModelOf } from './data/session-model'
import { sessionTranscriptOf } from './data/session-transcript'
import { useDiagramRepairedTranscript } from './data/use-session-diagram-transcript'
import { useSessionMarkRead } from './data/use-session-mark-read'
import { useSessionModelChoice } from './data/use-session-model-choice'
import { useSessionRunFailure } from './data/use-session-run-failure'
import { sessionViewModelOf } from './data/session-view-model'
import { retrySessionNow } from './data/use-retry-session'
import { OperatorRequestDock } from './operator-request-dock'
import { SessionUpdateCard } from './session-update-card'
import { useQueuedDock } from './data/use-queued-dock'
import { useStagedMessages } from './data/use-staged-messages'
import { useSessionAttachments } from './data/use-session-attachments'
import { useSessionReveal } from './data/use-session-reveal'
import { useSessionSkills } from './data/use-session-skills'
import { useSessionCommands } from './data/use-session-commands'
import { composerEntriesOf } from './data/session-commands'
import { composerActionsOf } from './data/session-composer-actions'
import { useSessionSummarise } from './data/use-session-summarise'
import { pendingOperatorRequestOf } from './data/use-operator-request'
import { useSessionStream } from './data/use-session-stream'
import { CommandRows } from './command-rows'
import { CommandListDialog } from './command-list-dialog'
import { ConnectionLine } from './connection-line'
import { QueuedDock } from './queued-dock'
import { RefusalRows } from './refusal-rows'
import { SessionPreviewsProvider } from './panel/browser/previews-provider'
import { ESessionPaneTab } from './panel/pane-tab'
import { SessionPaneProvider } from './panel/pane-value'
import { SessionPaneLayout } from './panel/session-pane-layout'
import { useSessionPaneWiring } from './panel/use-session-pane-wiring'
import { SessionContext } from './session-context'
import { SessionHeader } from './session-header'
import { StartFailedCard } from './start-failed-card'

export function SessionView({ sessionId }: { sessionId: string }) {
  const { snapshot, loadOlder } = useSessionStream({
    sessionId,
    connection: sessionStream,
    log: sessionLog(),
  })
  const routeAt = useRef(0)
  useEffect(() => {
    if (routeAt.current === 0) routeAt.current = performance.now()
  }, [])
  const hasEvents = snapshot.events.length > 0
  const openedReported = useRef(false)
  useEffect(() => {
    if (!hasEvents || openedReported.current) return
    openedReported.current = true
    track(
      'session_opened',
      sessionOpenedProps({
        sessionId,
        routeAt: routeAt.current,
        firstContentAt: performance.now(),
      }),
    )
  }, [hasEvents, sessionId])
  useSessionMarkRead({ sessionId, head: snapshot.events.at(-1)?.seq })
  const sessions = useV2Sessions()
  const listed = sessions.find((session) => session.sessionId === sessionId)
  const sessionNameOf = useMemo(() => {
    const titles = new Map(
      sessions.map((session) => [session.sessionId, session.title ?? undefined]),
    )
    return (id: string) => titles.get(id)
  }, [sessions])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const retryClientId = useRef<string | undefined>(undefined)
  const files = useComposerAttachments()
  const attachments = useSessionAttachments({ files })
  const working = isSessionWorking(snapshot.status)
  const turnStartedAt = useMemo(() => turnStartedAtOf(snapshot.foldable), [snapshot.foldable])
  const reveal = useSessionReveal(snapshot)
  const view = useMemo(
    () =>
      sessionTranscriptOf({
        events: snapshot.events,
        overlay: snapshot.overlay,
        reveal,
        sessionNameOf,
      }),
    [snapshot.events, snapshot.overlay, reveal, sessionNameOf],
  )
  const { items: transcriptItems, repairDiagram } = useDiagramRepairedTranscript({
    sessionId,
    items: view.items,
  })
  const boot = useMemo(
    () =>
      sessionBootViewOf({
        events: snapshot.foldable,
        status: snapshot.status,
        setupOutput: snapshot.setupOutput,
        catchingUp: snapshot.connection === ESessionConnection.CatchingUp,
      }),
    [snapshot.foldable, snapshot.status, snapshot.setupOutput, snapshot.connection],
  )
  const operatorRequest = useMemo(() => pendingOperatorRequestOf(view.items), [view.items])
  const model = useMemo(() => sessionViewModelOf(snapshot.view), [snapshot.view])
  const background = useMemo(
    () =>
      liveBackgroundOf({
        events: snapshot.foldable,
        live: snapshot.connection === ESessionConnection.Live,
      }),
    [snapshot.foldable, snapshot.connection],
  )
  const { panel, pane, openAgent, sheetOpenChange } = useSessionAgentWiring({
    sessionId,
    working,
  })
  const wiring = useSessionPaneWiring({
    sessionId,
    title: listed?.title ?? undefined,
    startedAt: listed?.createdAt,
    projectId: listed?.projectId ?? undefined,
    mainThreadId: listed?.mainThreadId,
    model,
    snapshot,
    pane,
  })
  const stagedRun = useStagedMessages({
    sessionId,
    events: snapshot.events,
    working,
    draft,
    onDraftChange: setDraft,
  })
  const queuedDock = useQueuedDock({
    sessionId,
    pending: snapshot.pending,
    queueStaged: stagedRun.queue,
    transcriptStaged: stagedRun.transcript,
    draft,
    onDraftChange: setDraft,
  })

  const handleRetry = () => retrySessionNow(sessionId)
  const handleStop = () => void stopSession({ api: sessionsApi, sessionId, notify: toast.error })
  const handleOpenPodSize = useCallback(() => {
    pane.openTab(ESessionPaneTab.Details)
    pane.requestPodSize()
  }, [pane.openTab, pane.requestPodSize])

  const rewind = useSessionRewind({
    sessionId,
    events: snapshot.events,
    api: sessionsApi,
    onRestore: (restored) => {
      setDraft((current) => mergedDraftOf({ rewound: restored.text, current }))
      attachments.restore({ attachments: restored.attachments, previewOf: restored.previewOf })
    },
  })
  const [dismissedRefusals, setDismissedRefusals] = useState<ReadonlySet<number>>(new Set())
  const refusals = useMemo(
    () =>
      sessionRefusalsOf(snapshot.events).filter(
        (refusal) => !dismissedRefusals.has(refusal.inboxId),
      ),
    [snapshot.events, dismissedRefusals],
  )
  const dismissRefusals = () =>
    setDismissedRefusals((current) => {
      const next = new Set(current)
      for (const refusal of refusals) next.add(refusal.inboxId)
      return next
    })

  const summarise = useSessionSummarise({ sessionId, events: snapshot.events })
  const skillEntries = useSessionSkills({ events: snapshot.foldable })
  const commandEntries = useSessionCommands()
  const [commandListOpen, setCommandListOpen] = useState(false)
  const composerEntries = useMemo(
    () => composerEntriesOf({ commands: commandEntries, skills: skillEntries }),
    [commandEntries, skillEntries],
  )
  const choice = useSessionModelChoice({
    sessionId,
    current: sessionModelOf(listed),
  })
  const composerActions = useMemo(
    () =>
      composerActionsOf({
        openModelPicker: () => choice.setOpen(true),
        openCommandList: () => setCommandListOpen(true),
      }),
    [choice.setOpen],
  )
  const failure = useSessionRunFailure({
    sessionId,
    events: snapshot.events,
    working,
    openAgent,
    onSwitchModel: () => choice.setOpen(true),
  })

  const handleSubmit = async (text: string) => {
    if (!attachments.checkSendable()) return
    const { media, uploads } = attachments
    if (text.trim().length === 0 && media.length === 0 && uploads.length === 0) return
    const clientId = retryClientId.current ?? crypto.randomUUID()
    setSending(true)
    try {
      await sessionsApi.post(postInputOf({ sessionId, text, clientId, media, uploads }))
      stagedRun.stage({
        clientId,
        text,
        attachments: [...media, ...attachmentsOf({ uploads })],
      })
      retryClientId.current = undefined
      setDraft('')
      attachments.clear()
    } catch (failure) {
      retryClientId.current = clientId
      toast.error(messageOf(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <SessionPaneProvider value={wiring.paneValue}>
      <SessionPreviewsProvider
        sessionId={sessionId}
        ports={wiring.ports}
        loaded={snapshot.view !== undefined}
        onOpened={wiring.openBrowserTab}
      >
        <ThreadPanelProvider value={panel}>
          <div className="flex min-h-0 flex-1 flex-col">
            <SessionHeader
              sessionId={sessionId}
              state={headerStateOfSession(snapshot.status)}
              routineId={listed?.routineId ?? null}
              title={listed?.title ?? null}
              naming={listed?.naming ?? false}
              branch={model.branch}
              entries={model.entries}
              subscriptions={model.subscriptionRows}
              shells={model.shells}
              shellTails={wiring.shellTails}
              crew={model.crew}
              crewRows={model.crewRows}
              previews={model.previews}
              paneCollapsed={pane.collapsed}
              onTogglePane={pane.toggleCollapsed}
              onOpenPane={pane.openPane}
              onOpenDetails={() => pane.setTab(ESessionPaneTab.Details)}
              onOpenPreview={wiring.openBrowser}
            />
            <SessionPaneLayout
              tab={pane.tab}
              setTab={pane.setTab}
              sheetOpen={pane.sheetOpen}
              setSheetOpen={sheetOpenChange}
              layout={pane.layout}
              rememberLayout={pane.rememberLayout}
              collapsed={pane.collapsed}
              setCollapsed={pane.setCollapsed}
            >
              <div className="min-h-0 flex-1">
                <ThreadTranscript
                  items={transcriptItems}
                  failureCard={failure.card}
                  failedLabel={failure.failedLabel}
                  pod={null}
                  working={working}
                  turnStartedAt={turnStartedAt}
                  background={background}
                  onRetryBoot={() => void handleRetry()}
                  onOpenPodSize={handleOpenPodSize}
                  rewind={rewind}
                  summarise={summarise.transcript}
                  repairDiagram={repairDiagram}
                  boot={boot}
                  staged={queuedDock.transcriptEntries}
                  onLoadOlder={loadOlder}
                />
              </div>
              <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-4 pb-4">
                <OperatorRequestDock sessionId={sessionId} request={operatorRequest} />
                {snapshot.skipped > 0 ? (
                  <SessionUpdateCard
                    skipped={snapshot.skipped}
                    writerAhead={snapshot.writerAhead}
                  />
                ) : null}
                <ConnectionLine
                  snapshot={snapshot}
                  onReconnect={() => sessionStream().reconnect()}
                />
                {snapshot.status?.state === ESessionStatus.StartFailed ? (
                  <StartFailedCard reason={snapshot.status.reason} onRetry={handleRetry} />
                ) : null}
                <RefusalRows refusals={refusals} onDismiss={dismissRefusals} />
                <SummariseDialog {...summarise.dialog} />
                <RewindDialog {...rewind.dialog} />
                <CommandListDialog
                  open={commandListOpen}
                  onOpenChange={setCommandListOpen}
                  entries={composerEntries}
                />
                <CommandRows rows={snapshot.status?.commands} />
                <QueuedDock dock={queuedDock} />
                <ThreadComposer
                  value={draft}
                  onValueChange={setDraft}
                  onSubmit={(text) => void handleSubmit(text)}
                  entries={composerEntries}
                  clientActions={composerActions}
                  sending={sending || attachments.uploading}
                  {...attachments.composerProps}
                  sendsAttachmentsAlone
                  working={working}
                  onStop={handleStop}
                  placeholder="Message Atlas…"
                >
                  {listed === undefined ? null : (
                    <ModelPickerControls
                      picker={choice.picker}
                      selection={choice.selection}
                      onSelectionChange={choice.onSelectionChange}
                      open={choice.open}
                      onOpenChange={choice.onOpenChange}
                    />
                  )}
                  <SessionContext context={model.context} spend={model.spend} />
                </ThreadComposer>
              </div>
            </SessionPaneLayout>
          </div>
        </ThreadPanelProvider>
      </SessionPreviewsProvider>
    </SessionPaneProvider>
  )
}
