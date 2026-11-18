'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import { SummariseDialog } from '@/features/threads/transcript/summarise-dialog'

import { attachmentsOf } from '@dltech/atlas-core'

import { panelValueOf } from './data/panel-value'
import { postInputOf } from './data/session-media'
import { sessionsApi } from './data/sessions-api'
import { stopSession } from './data/stop-session'
import { headerStateOfSession, isSessionWorking, sessionStateLineOf } from './data/session-state'
import { sessionLog, sessionStream } from './data/session-stream'
import { requestRewind, rewoundDraftOf, seqByEventIdOf } from './data/session-rewind'
import { sessionRefusalsOf } from './data/session-refusals'
import { sessionBootViewOf } from './data/session-boot-view'
import { sessionModelOf } from './data/session-model'
import { sessionTranscriptOf } from './data/session-transcript'
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
import { useSessionSummarise } from './data/use-session-summarise'
import { pendingOperatorRequestOf } from './data/use-operator-request'
import { useSessionStream } from './data/use-session-stream'
import { CommandRows } from './command-rows'
import { QueuedDock } from './queued-dock'
import { RefusalRows } from './refusal-rows'
import { SessionPreviewsProvider } from './panel/browser/previews-provider'
import { useSessionPane } from './panel/pane-state'
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
  const boot = useMemo(
    () =>
      sessionBootViewOf({
        events: snapshot.events,
        status: snapshot.status,
        setupOutput: snapshot.setupOutput,
        catchingUp: snapshot.connection === ESessionConnection.CatchingUp,
      }),
    [snapshot.events, snapshot.status, snapshot.setupOutput, snapshot.connection],
  )
  const operatorRequest = useMemo(() => pendingOperatorRequestOf(view.items), [view.items])
  const model = useMemo(() => sessionViewModelOf(snapshot.view), [snapshot.view])
  const background = useMemo(
    () =>
      liveBackgroundOf({
        events: snapshot.events,
        live: snapshot.connection === ESessionConnection.Live,
      }),
    [snapshot.events, snapshot.connection],
  )
  const panel = useMemo(() => panelValueOf({ sessionId, working }), [sessionId, working])
  const pane = useSessionPane(sessionId)
  const wiring = useSessionPaneWiring({ sessionId, model, snapshot, openTab: pane.openTab })
  const stateLine = sessionStateLineOf(snapshot)
  const stagedRun = useStagedMessages({
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

  const rewind = useMemo(() => {
    const seqs = seqByEventIdOf(snapshot.events)
    return {
      points: new Set(seqs.keys()),
      onRewind: ({ eventId }: { eventId: string; text: string }) => {
        const toSeq = seqs.get(eventId)
        if (toSeq === undefined) return
        requestRewind({ api: sessionsApi, sessionId, toSeq }).catch((failure) =>
          toast.error(messageOf(failure)),
        )
      },
    }
  }, [snapshot.events, sessionId])
  const refusals = useMemo(() => sessionRefusalsOf(snapshot.events), [snapshot.events])

  const summarise = useSessionSummarise({ sessionId, events: snapshot.events })
  const skillSpecs = useSessionSkills({ events: snapshot.events })
  const choice = useSessionModelChoice({
    sessionId,
    current: sessionModelOf(listed),
  })
  const failure = useSessionRunFailure({
    sessionId,
    events: snapshot.events,
    working,
    onSwitchModel: () => choice.setOpen(true),
  })

  const rewoundDraft = rewoundDraftOf(snapshot.events)

  useEffect(() => {
    if (rewoundDraft === undefined) return
    setDraft((current) => (current === '' ? rewoundDraft : current))
  }, [rewoundDraft])

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
              subscriptions={model.subscriptions}
              shells={model.shells}
              shellTails={wiring.shellTails}
              crew={model.crew}
              crewRows={model.crewRows}
              previews={model.previews}
              paneCollapsed={pane.collapsed}
              onTogglePane={pane.toggleCollapsed}
              onOpenPane={pane.openPane}
              onOpenPreview={wiring.openBrowser}
            />
            <SessionPaneLayout
              tab={pane.tab}
              setTab={pane.setTab}
              sheetOpen={pane.sheetOpen}
              setSheetOpen={pane.setSheetOpen}
              layout={pane.layout}
              rememberLayout={pane.rememberLayout}
              collapsed={pane.collapsed}
              setCollapsed={pane.setCollapsed}
            >
              <div className="min-h-0 flex-1">
                <ThreadTranscript
                  items={view.items}
                  failureCard={failure.card}
                  failedLabel={failure.failedLabel}
                  pod={null}
                  working={working}
                  background={background}
                  onRetryBoot={() => void handleRetry()}
                  rewind={rewind}
                  summarise={summarise.transcript}
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
                {stateLine === null ? null : (
                  <p role="status" className="truncate px-1 text-xs text-muted-foreground">
                    {stateLine}
                  </p>
                )}
                {snapshot.status?.state === ESessionStatus.StartFailed ? (
                  <StartFailedCard reason={snapshot.status.reason} onRetry={handleRetry} />
                ) : null}
                <RefusalRows refusals={refusals} />
                <SummariseDialog {...summarise.dialog} />
                <CommandRows rows={snapshot.status?.commands} />
                <QueuedDock dock={queuedDock} />
                <ThreadComposer
                  value={draft}
                  onValueChange={setDraft}
                  onSubmit={(text) => void handleSubmit(text)}
                  commandSpecs={skillSpecs}
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
