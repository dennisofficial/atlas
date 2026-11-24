'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { clientOnlyReason } from '@dltech/atlas-commands'
import type { Attachment } from '@dltech/atlas-core'

import { liveBackgroundOf } from '@dltech/atlas-client/crew'
import { mergedDraftOf } from '@dltech/atlas-client/session'
import { ESessionConnection, startFailureOf } from '@dltech/atlas-client/stream'
import { turnStartedAtOf } from '@dltech/atlas-client/transcript'
import { pendingOperatorRequestOf } from '@dltech/atlas-plugin-operator/client'

import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { messageOf } from '@/features/threads/data/use-send'
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
import { sessionBootViewOf } from './data/session-boot-view'
import { sessionModelOf } from './data/session-model'
import { sessionTranscriptOf } from './data/session-transcript'
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
import { CommandRows } from './command-rows'
import { CommandListDialog } from './command-list-dialog'
import { ConnectionLine } from './connection-line'
import { RefusalRows } from './refusal-rows'
import { SessionPreviewsProvider } from './panel/browser/previews-provider'
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
  const sessions = useV2Sessions()
  const listed = sessions.find((session) => session.sessionId === sessionId)
  const sessionNameOf = useMemo(() => {
    const titles = new Map(
      sessions.map((session) => [session.sessionId, session.title ?? undefined]),
    )
    return (id: string) => titles.get(id)
  }, [sessions])
  const working = isSessionWorking(snapshot.status)
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
  const operatorRequest = useMemo(
    () => pendingOperatorRequestOf({ events: snapshot.events }),
    [snapshot.events],
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
    staged: stagedRun.staged,
    items: transcriptItems,
    draft: composer.draft,
    onDraftChange: composer.setDraft,
    onRestoreAttachments: composer.attachments.restore,
  })

  const handleRetry = async () => {
    await retrySessionNow(sessionId)
  }
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
    events: snapshot.events,
    onSwitchModel: () => choice.setOpen(true),
    retryAfterModel: switchRetry,
  })
  const failure = useSessionRunFailure({
    sessionId,
    events: snapshot.events,
    working,
    openAgent,
    onSwitchModel: () => choice.setOpen(true),
    retryAfterModel: switchRetry,
    repair,
  })

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
                  items={queuedTranscript.transcript}
                  failureCard={failure.card}
                  repairCard={failure.repairCard}
                  failedLabel={failure.failedLabel}
                  pod={null}
                  working={working}
                  turnStartedAt={turnStartedAt}
                  background={background}
                  onRetryBoot={() => void handleRetry()}
                  onOpenPodSize={handleOpenPodSize}
                  rewind={rewind}
                  summarise={summarise.transcript}
                  resume={resume}
                  repairDiagram={repairDiagram}
                  boot={boot}
                  queued={queuedTranscript.queued}
                  onLoadOlder={loadOlder}
                />
              </div>
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
                <CommandRows rows={snapshot.status?.commands} />
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
                  <SessionContext context={model.context} spend={model.spend} />
                  <SessionUsage model={listed?.model} working={working} />
                </ThreadComposer>
              </div>
            </SessionPaneLayout>
          </div>
        </ThreadPanelProvider>
      </SessionPreviewsProvider>
    </SessionPaneProvider>
  )
}
