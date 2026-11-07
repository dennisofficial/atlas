'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { NamingTitle } from '@dltech/atlas-ui/ai/naming-title'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'

import { useV2Sessions } from '@/features/shell/use-v2-sessions'
import { EHeaderState, STATE_LABEL } from '@/features/threads/data/header-model'
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
import { sessionBootViewOf } from './data/session-boot-view'
import { sessionTranscriptOf } from './data/session-transcript'
import { useQueuedDock } from './data/use-queued-dock'
import { useSessionAttachments } from './data/use-session-attachments'
import { useSessionReveal } from './data/use-session-reveal'
import { useSessionStream } from './data/use-session-stream'
import { QueuedDock } from './queued-dock'

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

const BADGE_VARIANT: Record<EHeaderState, 'destructive' | 'default' | 'secondary'> = {
  [EHeaderState.Failed]: 'destructive',
  [EHeaderState.NeedsYou]: 'default',
  [EHeaderState.Running]: 'secondary',
  [EHeaderState.Idle]: 'secondary',
}

function SessionHeader({
  state,
  title,
  naming,
}: {
  state: EHeaderState
  title: string | null
  naming: boolean
}) {
  return (
    <header
      data-chrome="titlebar"
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-2 md:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Open navigation" />
        <h1 className="min-w-0 truncate text-sm font-medium">
          <NamingTitle title={title} naming={naming} fallback="Session" />
        </h1>
        <Badge variant="outline">v2</Badge>
      </div>
      <Badge variant={BADGE_VARIANT[state]}>{STATE_LABEL[state]}</Badge>
    </header>
  )
}

export function SessionView({ sessionId }: { sessionId: string }) {
  const snapshot = useSessionStream({
    sessionId,
    connection: sessionStream,
    cache: sessionCache(),
  })
  const listed = useV2Sessions().find((session) => session.sessionId === sessionId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
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
  const panel = useMemo(() => panelValueOf({ sessionId, working }), [sessionId, working])
  const stateLine = sessionStateLineOf(snapshot)
  const queuedDock = useQueuedDock({
    sessionId,
    queued: snapshot.status?.queued,
    events: snapshot.events,
    draft,
    onDraftChange: setDraft,
  })

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
        />
        <div className="min-h-0 flex-1">
          <ThreadTranscript
            items={view.items}
            failureCard={null}
            failedLabel={null}
            pod={null}
            working={working}
            onRetryBoot={noop}
            rewind={null}
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
          />
        </div>
      </div>
    </ThreadPanelProvider>
  )
}
