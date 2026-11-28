'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { clientOnlyReason } from '@dltech/atlas-commands'
import type { Attachment } from '@dltech/atlas-core'

import { liveBackgroundOf } from '@dltech/atlas-client/crew'
import { mergedDraftOf, sessionBootViewOf } from '@dltech/atlas-client/session'
import {
  blockingCommandOf,
  ESessionConnection,
  isTurnRunning,
  startFailureOf,
} from '@dltech/atlas-client/stream'
import { turnStartedAtOf } from '@dltech/atlas-client/transcript'
import { pendingOperatorRequestOf } from '@dltech/atlas-plugin-operator/client'

import { useSessions } from '@/features/shell/use-sessions'
import { messageOf } from '@/features/threads/data/message-of'
import { ThreadPanelProvider } from '@/features/threads/panel/thread-panel-context'
import { mediaUrls } from '@/features/threads/data/media-urls'
import { ModelPickerControls } from '@/features/threads/model-picker'
import { ThreadComposer } from '@/features/threads/thread-composer'
import { ThreadTranscript } from '@/features/threads/thread-transcript'
import { SummariseDialog } from '@/features/threads/transcript/summarise-dialog'
import { RewindDialog } from '@/features/threads/transcript/rewind-dialog'
import { track } from '@/lib/analytics/analytics'
import { sessionOpenedProps } from '@/lib/analytics/perf'

import { readingClasses } from '@dltech/atlas-ui/tokens'

import { useSessionAgentWiring } from './data/use-session-agent-wiring'
import { sessionsApi } from './data/sessions-api'
import { stopSession } from './data/stop-session'
import { headerStateOfSession, isSessionWorking } from './data/session-state'
import { sessionLog, sessionStream } from './data/session-stream'
import { useSessionRewind } from './data/use-session-rewind'
import { sessionRefusalsOf } from './data/session-refusals'
import { sessionModelOf } from './data/session-model'
import { sessionTranscriptOf } from './data/session-transcript'
import { SessionDiagramRepairProvider } from '@/features/threads/data/session-diagram-repair-provider'

import { useDiagramRepairedTranscript } from './data/use-session-diagram-transcript'
import { useSessionMarkRead } from './data/use-session-mark-read'
import { useSessionModelChoice } from './data/use-session-model-choice'
import { useModelSwitchRetry } from './data/use-model-switch-retry'
import { useSessionRunFailure } from './data/use-session-run-failure'
import { useCredentialRepair } from './data/use-credential-repair'
import { sessionViewModelOf } from './data/session-view-model'
import { retrySessionNow } from './data/use-retry-session'
import { OperatorRequestDock } from './operator-request-dock'
import { RepairKeyDialog } from './repair-key-dialog'
import { RepairSignInDialog } from './repair-sign-in-dialog'
import { RepairStrip } from './repair-strip'
import { SessionUpdateCard } from './session-update-card'
import { useQueuedTranscript } from './data/use-queued-transcript'
import { useQuickStopRestore } from './data/use-quick-stop-restore'
import { useStagedMessages } from './data/use-staged-messages'
import { useSessionComposer } from './data/use-session-composer'
import { useSessionDraft } from './data/use-session-draft'
import { useDraftAttachments } from './data/use-draft-attachments'
import { useSessionReveal } from './data/use-session-reveal'
import { useSessionSkills } from './data/use-session-skills'
import { useSessionCommands } from './data/use-session-commands'
import { composerEntriesOf, requestResume, resumePendingOf } from './data/session-commands'
import { composerActionsOf } from './data/session-composer-actions'
import { useSessionSummarise } from './data/use-session-summarise'
import { useSessionStream } from './data/use-session-stream'
import { BlockingDock } from './blocking/blocking-dock'
import { CommandListDialog } from './command-list-dialog'
import { ConnectionLine } from './connection-line'
import { RefusalRows } from './refusal-rows'
import { SessionPreviewsProvider } from './panel/browser/previews-provider'
import { SessionDetailsCard, detailsCardReserveOf } from './panel/details-card'
import { SessionCheckoutScope } from './panel/checkout-scope'
import { ESessionPaneTab } from './panel/pane-tab'
import { SessionPaneProvider } from './panel/pane-value'
import { SessionPaneLayout } from './panel/session-pane-layout'
import { useSessionPaneWiring } from './panel/use-session-pane-wiring'
import { SessionContext } from './session-context'
import { SessionUsage } from './session-usage'
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
  const sessions = useSessions()
  const listed = sessions.find((session) => session.sessionId === sessionId)
  const sessionNameOf = useMemo(() => {
    const titles = new Map(
      sessions.map((session) => [session.sessionId, session.title ?? undefined]),
    )
    return (id: string) => titles.get(id)
  }, [sessions])
  const working = isSessionWorking(snapshot.status)
  const blocking = blockingCommandOf(snapshot.status)
  const composer = useSessionComposer({ sessionId, working })
  const draftAttachments = useDraftAttachments({
    media: composer.attachments.media,
    uploads: composer.attachments.uploads,
  })
  const drafts = useSessionDraft({
    sessionId,
    text: composer.draft,
    attachments: draftAttachments,
    onRestore: (stored) => {
      composer.setDraft(stored.text)
      composer.attachments.restore({
        attachments: stored.attachments,
        previewOf: (hash) => mediaUrls.urlOf({ sessionId, hash }),
      })
    },
  })
  const startFailure = startFailureOf(snapshot.status)
  const turnStartedAt = useMemo(
    () => turnStartedAtOf({ events: snapshot.foldable, status: snapshot.status }),
    [snapshot.foldable, snapshot.status],
  )
  const reveal = useSessionReveal(snapshot)
  const view = useMemo(
    () =>
      sessionTranscriptOf({
        events: snapshot.events,
        foldable: snapshot.foldable,
        overlay: snapshot.overlay,
        reveal,
        sessionNameOf,
      }),
    [snapshot.events, snapshot.foldable, snapshot.overlay, reveal, sessionNameOf],
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
  const operatorRequest = useMemo(
    () => pendingOperatorRequestOf({ events: snapshot.foldable }),
    [snapshot.foldable],
  )
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
  const previewOf = useCallback((hash: string) => mediaUrls.urlOf({ sessionId, hash }), [sessionId])
  const restoreAttachments = useCallback(
    (attachments: readonly Attachment[]) => {
      if (attachments.length === 0) return
      composer.attachments.restore({ attachments, previewOf })
    },
    [composer.attachments.restore, previewOf],
  )
  const restoreQuickStop = useCallback(
    (restored: { text: string; attachments: readonly Attachment[] }) => {
      composer.setDraft((current) => mergedDraftOf({ rewound: restored.text, current }))
      restoreAttachments(restored.attachments)
    },
    [composer.setDraft, restoreAttachments],
  )
  const stagedRun = useStagedMessages({
    sessionId,
    events: snapshot.events,
    pending: snapshot.pending,
    draft: composer.draft,
    onDraftChange: composer.setDraft,
    onRestoreAttachments: restoreAttachments,
  })
  const queuedTranscript = useQueuedTranscript({
    sessionId,
    pending: snapshot.pending,
    events: snapshot.events,
    foldable: snapshot.foldable,
    staged: stagedRun.staged,
    items: transcriptItems,
    sessionNameOf,
    draft: composer.draft,
    onDraftChange: composer.setDraft,
    onRestoreAttachments: composer.attachments.restore,
  })

  const handleRetry = async () => {
    await retrySessionNow(sessionId)
  }
  const handleStop = () => void stopSession({ api: sessionsApi, sessionId, notify: toast.error })
  const handleOpenPodSize = useCallback(() => {
    pane.openDetails()
    pane.requestPodSize()
  }, [pane.openDetails, pane.requestPodSize])

  const rewind = useSessionRewind({
    sessionId,
    events: snapshot.events,
    api: sessionsApi,
    onRestore: (restored) => {
      composer.setDraft((current) => mergedDraftOf({ rewound: restored.text, current }))
      composer.attachments.restore({
        attachments: restored.attachments,
        previewOf: restored.previewOf,
      })
    },
  })
  useQuickStopRestore({
    sessionId,
    quickStops: snapshot.quickStops,
    onRestore: restoreQuickStop,
  })
  const [dismissedRefusals, setDismissedRefusals] = useState<ReadonlySet<number>>(new Set())
  const refusals = useMemo(
    () =>
      sessionRefusalsOf(snapshot.foldable).filter(
        (refusal) => !dismissedRefusals.has(refusal.inboxId),
      ),
    [snapshot.foldable, dismissedRefusals],
  )
  const dismissRefusals = () =>
    setDismissedRefusals((current) => {
      const next = new Set(current)
      for (const refusal of refusals) next.add(refusal.inboxId)
      return next
    })

  const summarise = useSessionSummarise({ sessionId, events: snapshot.events })
  const resume = useMemo(
    () => ({
      pending: resumePendingOf(snapshot.status?.commands),
      onResume: () => {
        requestResume({ api: sessionsApi, sessionId }).catch((failure: unknown) => {
          toast.error(messageOf(failure))
        })
      },
    }),
    [sessionId, snapshot.status?.commands],
  )
  const skillEntries = useSessionSkills({ events: snapshot.foldable })
  const commandEntries = useSessionCommands()
  const [commandListOpen, setCommandListOpen] = useState(false)
  const composerEntries = useMemo(
    () => composerEntriesOf({ commands: commandEntries, skills: skillEntries }),
    [commandEntries, skillEntries],
  )
  const switchRetry = useModelSwitchRetry()
  const choice = useSessionModelChoice({
    sessionId,
    current: sessionModelOf(listed),
    onSelected: switchRetry.handleModelSelected,
    onClosed: switchRetry.disarm,
  })
  const composerActions = useMemo(
    () =>
      composerActionsOf({
        openModelPicker: () => choice.setOpen(true),
        openCommandList: () => setCommandListOpen(true),
        reportHidden: (name) => toast.info(clientOnlyReason(name)),
      }),
    [choice.setOpen],
  )
  const repair = useCredentialRepair({
    sessionId,
    mainThreadId: listed?.mainThreadId,
    events: snapshot.foldable,
    onSwitchModel: () => choice.setOpen(true),
    retryAfterModel: switchRetry,
  })
  const failure = useSessionRunFailure({
    sessionId,
    events: snapshot.foldable,
    working,
    openAgent,
    onSwitchModel: () => choice.setOpen(true),
    retryAfterModel: switchRetry,
    repair,
  })

  return (
    <SessionPaneProvider value={wiring.paneValue}>
      <SessionPreviewsProvider
        ports={wiring.ports}
        loaded={snapshot.view !== undefined}
        onOpen={wiring.openBrowser}
      >
        <ThreadPanelProvider value={panel}>
          <SessionCheckoutScope>
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
                detailsOpen={pane.detailsShown}
                onToggleDetails={pane.toggleDetails}
                onOpenDetails={pane.openDetails}
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
                <div className="@container relative min-h-0 flex-1">
                  <SessionDetailsCard
                    open={pane.detailsShown}
                    onOpenChanges={() => pane.openTab(ESessionPaneTab.Changes)}
                  />
                  <div className={`h-full ${detailsCardReserveOf(pane.detailsShown)}`}>
                    <SessionDiagramRepairProvider repairDiagram={repairDiagram}>
                      <ThreadTranscript
                        sessionId={sessionId}
                        items={queuedTranscript.transcript}
                        failureCard={failure.card}
                        repairCard={failure.repairCard}
                        failedLabel={failure.failedLabel}
                        pod={null}
                        working={isTurnRunning(snapshot.status)}
                        turnStartedAt={turnStartedAt}
                        background={background}
                        onRetryBoot={() => void handleRetry()}
                        onOpenPodSize={handleOpenPodSize}
                        rewind={rewind}
                        summarise={summarise.transcript}
                        resume={resume}
                        boot={boot}
                        queued={{ ...queuedTranscript.queued, waitLabel: blocking?.copy.queued }}
                        onLoadOlder={loadOlder}
                      />
                    </SessionDiagramRepairProvider>
                  </div>
                </div>
                <div className="@container shrink-0">
                  <div className={detailsCardReserveOf(pane.detailsShown)}>
                    <div
                      className={`mx-auto flex w-full ${readingClasses.measure} shrink-0 flex-col gap-2 px-4 pb-[max(1rem,var(--safe-area-bottom))]`}
                    >
                      <OperatorRequestDock sessionId={sessionId} request={operatorRequest} />
                      <RepairStrip strip={repair.strip} />
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
                      {startFailure === undefined ? null : (
                        <StartFailedCard reason={startFailure.reason} onRetry={handleRetry} />
                      )}
                      <RefusalRows refusals={refusals} onDismiss={dismissRefusals} />
                      <RepairSignInDialog {...repair.dialogs.signIn} />
                      <RepairKeyDialog {...repair.dialogs.key} />
                      <SummariseDialog {...summarise.dialog} />
                      <RewindDialog {...rewind.dialog} />
                      <CommandListDialog
                        open={commandListOpen}
                        onOpenChange={setCommandListOpen}
                        entries={composerEntries}
                      />
                      <BlockingDock blocking={blocking} commands={snapshot.status?.commands}>
                        <ThreadComposer
                          value={composer.draft}
                          onValueChange={composer.setDraft}
                          onSubmit={(text) =>
                            void composer.handleSubmit({
                              text,
                              stage: stagedRun.stage,
                              onSent: drafts.handleSent,
                            })
                          }
                          entries={composerEntries}
                          clientActions={composerActions}
                          sending={composer.sending}
                          {...composer.attachments.composerProps}
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
                          <span aria-hidden className="flex-1" />
                          <SessionContext context={model.context} spend={model.spend} />
                          <SessionUsage model={listed?.model} working={working} />
                        </ThreadComposer>
                      </BlockingDock>
                    </div>
                  </div>
                </div>
              </SessionPaneLayout>
            </div>
          </SessionCheckoutScope>
        </ThreadPanelProvider>
      </SessionPreviewsProvider>
    </SessionPaneProvider>
  )
}
