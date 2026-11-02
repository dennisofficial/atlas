'use client'

import { useMemo, useState } from 'react'

import { liveSteps } from '@dltech/atlas-client/transcript'

import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { headerStateOf, spawnerIdOf } from './data/header-model'
import { bootViewOf, isPodFailed, isPodLiveEligible } from './data/boot-view'
import { clearedDraftOf } from './data/composer-handoff'
import { notConfiguredOf } from './data/not-configured'
import { restoredDraftOf } from './data/take-back'
import { useThreadBackend } from './data/use-thread-backend'
import { useThreadNaming } from './data/use-thread-naming'
import { eventsFromWire } from './data/events-from-wire'
import { durableTranscriptOf } from './data/transcript'
import { useDetailsInput } from './data/use-details-input'
import { useComposerDock } from './data/use-composer-dock'
import { useComposerAttachments } from './data/use-composer-attachments'
import { useComposerDraft } from './data/use-composer-draft'
import { useComposerHandoff } from './data/use-composer-handoff'
import { useAfterConnect } from './data/use-after-connect'
import { useThreadAttention } from './data/use-thread-attention'
import { useThreadViewActions } from './data/use-thread-view-actions'
import { useTranscriptView } from './data/use-transcript-view'
import { useOperatorInput } from './data/use-operator-input'
import { useReveal } from './data/use-reveal'
import { useParentTitle } from './data/use-parent-title'
import { usePodResize } from './data/use-pod-resize'
import { usePodStatus } from './data/use-pod-status'
import { usePullRequests } from './data/use-pull-requests'
import { useThreadRewind } from './data/use-thread-rewind'
import { useMarkRead } from './data/use-mark-read'
import { useThreadMetadata } from './data/use-thread-metadata'
import { useThreadSignals } from './data/use-thread-signals'
import { useSend } from './data/use-send'
import { useThreadModel } from './data/use-thread-model'
import { useThreadSource } from './data/use-thread-source'
import { useThreadSubmit } from './data/use-thread-submit'
import { useTakeBackEscape } from './data/use-take-back-escape'
import { useThreadCommands } from './commands/use-thread-commands'
import { ThreadMainSlot } from './context-viewer/main-slot'
import { ComposerFooter } from './composer-footer'
import { ThreadPanelProvider } from './panel/thread-panel-context'
import { useRightPanel } from './panel/use-right-panel'
import { useThreadPanelValue } from './panel/use-thread-panel-value'
import { isBootStarting } from './sandbox-boot-props'
import { ThreadHeader } from './thread-header'
import { ThreadLayout } from './thread-layout'
import { ThreadLoadError } from './thread-load-error'
import { ThreadMissing } from './thread-missing'
import { ThreadTranscript } from './thread-transcript'

const NOT_FOUND = 404
const STARTING_PLACEHOLDER = 'The sandbox is starting — you can keep typing…'

export function ThreadView({ threadId }: { threadId: string }) {
  const backend = useThreadBackend()
  const thread = useCloudQuery({
    key: `thread:${threadId}`,
    load: () => backend.fetchThread(threadId),
  })
  const [liveEligible, setLiveEligible] = useState(false)
  const model = useThreadModel({ threadId, stored: thread.data?.model })
  const signals = useThreadSignals(threadId)
  useThreadMetadata({ threadId, signals })
  useMarkRead({ threadId, signals, head: thread.data?.head })
  const source = useThreadSource({
    threadId,
    signals,
    liveEligible,
    onModelChanged: model.handleRemoteChange,
  })
  const { events, steps, outputs, loaded, error, working, channel, sendLive } = source
  const { sending, send, retryBoot } = useSend()
  useAfterConnect({
    live: source.live,
    threadId,
    afterConnect: backend.afterConnect,
    send: sendLive,
  })
  const rightPanel = useRightPanel()
  const pullRequests = usePullRequests({ threadId, channel, thread: thread.data })
  const spawnerId = spawnerIdOf(thread.data)
  const parentTitle = useParentTitle(spawnerId)
  const [draft, setDraft] = useState('')
  const images = useComposerAttachments()
  const drafts = useComposerDraft({
    scope: threadId,
    text: draft,
    uploads: images.uploads,
    onRestore: (stored) => {
      setDraft(stored.text)
      images.restore({ uploads: stored.uploads, images: [] })
    },
  })

  const { pod, refresh } = usePodStatus({ threadId, signals })
  const { visible, handleEscape } = useTakeBackEscape({
    threadId,
    events,
    podState: pod?.state ?? null,
    setDraft,
    onRestoreUploads: (uploads) => images.restore({ uploads, images: [] }),
  })
  const parsed = useMemo(() => eventsFromWire(visible), [visible])
  const durable = useMemo(() => durableTranscriptOf({ events: parsed }), [parsed])
  const live = useMemo(() => liveSteps({ steps, events: parsed }), [steps, parsed])
  const reveal = useReveal({ steps, events: parsed })
  const view = useTranscriptView({ durable, live, outputs, reveal })
  const dock = useComposerDock({
    threadId,
    visible,
    source,
    picker: model.picker,
    selection: model.selection,
    onRestore: (taken) => {
      setDraft((current) => restoredDraftOf({ current, restored: taken.text }))
      images.restore({ uploads: taken.uploads, images: taken.images })
    },
  })
  const operator = useOperatorInput(source)
  const handoff = useComposerHandoff({
    events: visible,
    pending: source.pending,
    onSettle: (settled) => setDraft((current) => clearedDraftOf({ current, handoff: settled })),
  })
  const { rewind, rewindPoints } = useThreadRewind({
    threadId,
    events: parsed,
    source,
    working,
    podState: pod?.state ?? null,
    setDraft,
  })
  const eligibleNow = isPodLiveEligible(pod)
  if (eligibleNow !== liveEligible) setLiveEligible(eligibleNow)
  const boot = useMemo(() => bootViewOf({ pod, now: 0 }), [pod])
  const notConfigured = useMemo(() => notConfiguredOf(pod), [pod])
  const handleResize = usePodResize({ threadId, refresh })
  const details = useDetailsInput({
    thread: thread.data,
    events: parsed,
    pullRequests,
    onResize: handleResize,
  })
  const panel = useThreadPanelValue({
    threadId,
    channel,
    pod,
    details,
    loaded,
    error,
    working,
    rightPanel,
    refresh,
  })
  const commands = useThreadCommands({
    threadId,
    channel,
    live: source.live,
    projectId: thread.data?.projectId,
    working,
    rightPanel,
    retryBoot,
    refresh,
  })
  const handleSubmit = useThreadSubmit({
    threadId,
    handleCommand: commands.handleCommand,
    attachments: images,
    send,
    sendLive,
    setDraft,
    onSent: (sent) => {
      drafts.handleSent(sent.text)
      handoff.begin(sent)
      source.refreshEvents()
      refresh()
    },
  })
  const { handleModelChange, handleRetryBoot, handleStop } = useThreadViewActions({
    threadId,
    source,
    model,
    retryBoot,
    refresh,
  })

  const { attention, availability } = useThreadAttention({
    threadId,
    events: parsed,
    live,
    source,
    commands,
    panel,
    waitingSnapshot: thread.data?.status?.waitingForModel,
  })

  const naming = useThreadNaming({
    threadId,
    loading: thread.state === EQueryState.Loading,
    storedTitle: thread.data?.title ?? null,
    liveTitle: source.liveTitle,
    titling: source.titling,
    pod,
  })

  if (thread.state === EQueryState.Failed && thread.error.status === NOT_FOUND) {
    return <ThreadMissing />
  }

  const starting = isBootStarting(boot)
  const failed = isPodFailed(pod)

  const header = (
    <ThreadHeader
      title={naming.headerTitle}
      naming={naming.naming}
      state={headerStateOf({
        failed,
        working,
        waitingOnOperator: source.waitingOnOperator,
      })}
      parent={spawnerId === undefined ? undefined : { id: spawnerId, title: parentTitle }}
      local={backend.local}
      onOpenPanel={() => rightPanel.setSheetOpen(true)}
    />
  )

  return (
    <ThreadPanelProvider value={panel}>
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <ThreadLayout
          tab={rightPanel.tab}
          onTabChange={rightPanel.setTab}
          sheetOpen={rightPanel.sheetOpen}
          onSheetOpenChange={rightPanel.setSheetOpen}
        >
          {error !== null && !loaded ? <ThreadLoadError error={error} /> : null}
          <ThreadMainSlot
            footer={
              <ComposerFooter
                notConfigured={notConfigured}
                operator={{
                  request: operator.request,
                  submitting: operator.submitting,
                  onSubmit: (value) => void operator.handleSubmit(value),
                }}
                rewind={{
                  pick: rewind.pick,
                  applying: rewind.applying,
                  onCancel: rewind.handleCancel,
                  onConfirm: () => void rewind.handleConfirm(),
                }}
                dock={dock}
                strip={attention.strip}
                usage={dock.usage}
                modelPicker={{
                  picker: model.picker,
                  selection: model.selection,
                  onSelectionChange: handleModelChange,
                  open: commands.modelOpen,
                  onOpenChange: commands.setModelOpen,
                }}
                value={draft}
                onValueChange={setDraft}
                onSubmit={handleSubmit}
                onEscape={() => void handleEscape()}
                sending={sending || handoff.waiting || images.uploading}
                working={working}
                onStop={handleStop}
                {...images.composerProps}
                commandSpecs={commands.specs}
                placeholder={starting ? STARTING_PLACEHOLDER : dock.placeholder}
              />
            }
          >
            <ThreadTranscript
              items={view.items}
              failureCard={attention.card}
              waitCard={availability.card}
              failedLabel={attention.failedLabel}
              pod={pod}
              working={working}
              onRetryBoot={() => void handleRetryBoot()}
              rewind={{
                points: rewindPoints,
                onRewind: (picked) => void rewind.handlePick(picked),
              }}
            />
          </ThreadMainSlot>
        </ThreadLayout>
      </div>
    </ThreadPanelProvider>
  )
}
