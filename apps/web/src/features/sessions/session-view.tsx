'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ESessionStatus } from '@dltech/atlas-core'

import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { messageOf } from '@/features/threads/data/use-send'
import { EMPTY_DETAILS } from '@/features/threads/panel/details/details-input'
import {
  ThreadPanelProvider,
  type ThreadPanelValue,
} from '@/features/threads/panel/thread-panel-context'
import { useComposerAttachments } from '@/features/threads/data/use-composer-attachments'
import { ThreadComposer } from '@/features/threads/thread-composer'
import { ThreadTranscript } from '@/features/threads/thread-transcript'

import { postInputOf } from './data/session-media'
import { sessionsApi } from './data/sessions-api'
import { headerStateOfSession, isSessionWorking, sessionStateLineOf } from './data/session-state'
import { sessionCache, sessionStream } from './data/session-stream'
import {
  ERewindOutcome,
  requestRewind,
  rewindOutcomeOf,
  rewoundDraftOf,
  seqByEventIdOf,
  type PendingRewind,
} from './data/session-rewind'
import { sessionBootViewOf } from './data/session-boot-view'
import { sessionTranscriptOf } from './data/session-transcript'
import { sessionViewModelOf } from './data/session-view-model'
import { retrySessionNow } from './data/use-retry-session'
import { useQueuedDock } from './data/use-queued-dock'
import { useSessionAttachments } from './data/use-session-attachments'
import { useSessionReveal } from './data/use-session-reveal'
import { useSessionStream } from './data/use-session-stream'
import { QueuedDock } from './queued-dock'
import { SessionContext } from './session-context'
import { SessionHeader } from './session-header'
import { StartFailedCard } from './start-failed-card'

const noop = () => undefined

const panelValueOf = (args: { sessionId: string; working: boolean }): ThreadPanelValue => ({
  threadId: args.sessionId,
  channel: null,
  pod: null,
  details: EMPTY_DETAILS,
  loaded: true,
  error: null,
  working: args.working,
  changesPath: undefined,
  agentId: undefined,
  contextPath: undefined,
  filePath: undefined,
  openChanges: noop,
  openAgent: noop,
  openDetails: noop,
  clearAgent: noop,
  openContextFile: noop,
  toggleContextFile: noop,
  closeContextFile: noop,
  openFile: noop,
  closeFile: noop,
  closePanel: noop,
  refreshPod: noop,
})

export function SessionView({ sessionId }: { sessionId: string }) {
  const snapshot = useSessionStream({
    sessionId,
    connection: sessionStream,
    cache: sessionCache(),
  })
  const listed = useV2Sessions().find((session) => session.sessionId === sessionId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingRewind, setPendingRewind] = useState<PendingRewind | undefined>(undefined)
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
      }),
    [snapshot.events, snapshot.overlay, reveal],
  )
  const boot = useMemo(
    () =>
      sessionBootViewOf({
        events: snapshot.events,
        status: snapshot.status,
        setupOutput: snapshot.setupOutput,
      }),
    [snapshot.events, snapshot.status, snapshot.setupOutput],
  )
  const model = useMemo(() => sessionViewModelOf(snapshot.view), [snapshot.view])
  const panel = useMemo(() => panelValueOf({ sessionId, working }), [sessionId, working])
  const stateLine = sessionStateLineOf(snapshot)
  const queuedDock = useQueuedDock({
    sessionId,
    queued: snapshot.status?.queued,
    draft,
    onDraftChange: setDraft,
  })

  const handleRetry = () => retrySessionNow(sessionId)

  const rewind = useMemo(() => {
    const seqs = seqByEventIdOf(snapshot.events)
    return {
      points: new Set(seqs.keys()),
      onRewind: ({ eventId, text }: { eventId: string; text: string }) => {
        const toSeq = seqs.get(eventId)
        if (toSeq === undefined) return
        requestRewind({ api: sessionsApi, sessionId, toSeq, eventId, text }).then(
          setPendingRewind,
          (failure) => toast.error(messageOf(failure)),
        )
      },
    }
  }, [snapshot.events, sessionId])
  const rewindOutcome =
    pendingRewind === undefined
      ? undefined
      : rewindOutcomeOf({ events: snapshot.events, pending: pendingRewind })

  const rewoundDraft = rewoundDraftOf(snapshot.events)

  useEffect(() => {
    if (rewoundDraft === undefined) return
    setDraft((current) => (current === '' ? rewoundDraft : current))
  }, [rewoundDraft])

  useEffect(() => {
    if (rewindOutcome?.kind !== ERewindOutcome.Applied) return
    setDraft(rewindOutcome.draft)
    setPendingRewind(undefined)
  }, [rewindOutcome])

  const handleSubmit = async (text: string) => {
    if (!attachments.checkSendable()) return
    const { media, uploads } = attachments
    if (text.trim().length === 0 && media.length === 0 && uploads.length === 0) return
    setSending(true)
    try {
      await sessionsApi.post(postInputOf({ sessionId, text, media, uploads }))
      setDraft('')
      attachments.clear()
    } catch (failure) {
      toast.error(messageOf(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <ThreadPanelProvider value={panel}>
      <div className="flex min-h-0 flex-1 flex-col">
        <SessionHeader
          state={headerStateOfSession(snapshot.status)}
          title={listed?.title ?? null}
          naming={listed?.naming ?? false}
          branch={model.branch}
          entries={model.entries}
        />
        <div className="min-h-0 flex-1">
          <ThreadTranscript
            items={view.items}
            failureCard={null}
            failedLabel={null}
            pod={null}
            working={working}
            onRetryBoot={() => void handleRetry()}
            rewind={rewind}
            summarise={null}
            boot={boot}
          />
        </div>
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
          {stateLine === null ? null : (
            <p role="status" className="truncate px-1 text-xs text-muted-foreground">
              {stateLine}
            </p>
          )}
          {snapshot.status?.state === ESessionStatus.StartFailed ? (
            <StartFailedCard reason={snapshot.status.reason} onRetry={handleRetry} />
          ) : null}
          {rewindOutcome?.kind !== ERewindOutcome.Refused ? null : (
            <p role="alert" className="px-1 text-xs text-destructive">
              {rewindOutcome.reason}
            </p>
          )}
          <QueuedDock dock={queuedDock} />
          <ThreadComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={(text) => void handleSubmit(text)}
            sending={sending || attachments.uploading}
            {...attachments.composerProps}
            sendsAttachmentsAlone
            working={working}
            placeholder="Message Atlas…"
          >
            <SessionContext context={model.context} spend={model.spend} />
          </ThreadComposer>
        </div>
      </div>
    </ThreadPanelProvider>
  )
}
