'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { liveSteps } from '@dltech/atlas-client/transcript'

import { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { headerStateOf, spawnerIdOf } from './data/header-model'
import { bootViewOf, isPodFailed, isPodLiveEligible } from './data/boot-view'
import { clearedDraftOf } from './data/composer-handoff'
import { notConfiguredOf } from './data/not-configured'
import { restoredDraftOf } from './data/take-back'
import type { ModelSelection } from './data/model-selection'
import { fetchThread } from './data/threads-api'
import { useThreadNaming } from './data/use-thread-naming'
import { eventsFromWire } from './data/events-from-wire'
import { durableTranscriptOf, transcriptViewOf } from './data/transcript'
import { useDetailsInput } from './data/use-details-input'
import { useComposerDock } from './data/use-composer-dock'
import { useComposerAttachments } from './data/use-composer-attachments'
import { useComposerHandoff } from './data/use-composer-handoff'
import { useOperatorInput } from './data/use-operator-input'
import { useReveal } from './data/use-reveal'
import { useParentTitle } from './data/use-parent-title'
import { usePodResize } from './data/use-pod-resize'
import { usePodStatus } from './data/use-pod-status'
import { usePullRequests } from './data/use-pull-requests'
import { userRewindPoints } from './data/rewind'
import { useRewind } from './data/use-rewind'
import { useMarkRead } from './data/use-mark-read'
import { useTitleRefresh } from './data/use-title-refresh'
import { useThreadSignals } from './data/use-thread-signals'
import { useSend } from './data/use-send'
import { useThreadModel } from './data/use-thread-model'
import { useThreadSource } from './data/use-thread-source'
import { useThreadSubmit } from './data/use-thread-submit'
import { useTakeBackEscape } from './data/use-take-back-escape'
import { useThreadCommands } from './commands/use-thread-commands'
import { ThreadMainSlot } from './context-viewer/main-slot'
import { ComposerContext, ComposerDock } from './composer-dock'
import { ModelPickerControls } from './model-picker'
import { NotConfiguredAlert } from './not-configured-alert'
import { OperatorInputCard } from './operator-input-card'
import { ThreadPanelProvider } from './panel/thread-panel-context'
import { useRightPanel } from './panel/use-right-panel'
import { useThreadPanelValue } from './panel/use-thread-panel-value'
import { isBootStarting } from './sandbox-boot-props'
import { ThreadComposer } from './thread-composer'
import { ThreadHeader } from './thread-header'
import { ThreadLayout } from './thread-layout'
import { ThreadMissing } from './thread-missing'
import { ThreadTranscript } from './thread-transcript'
import { RewindDialog } from './transcript/rewind-dialog'

const NOT_FOUND = 404
const STARTING_PLACEHOLDER = 'The sandbox is starting — you can keep typing…'

export function ThreadView({ threadId }: { threadId: string }) {
  const thread = useCloudQuery({
    key: threadId,
    load: () => fetchThread(threadId),
  })
  const [liveEligible, setLiveEligible] = useState(false)
  const model = useThreadModel({ threadId, stored: thread.data?.model })
  const signals = useThreadSignals(threadId)
  useTitleRefresh({
    signals,
    titled: thread.data?.title != null,
    reload: thread.reload,
  })
  useMarkRead({ threadId, signals, head: thread.data?.head })
  const source = useThreadSource({
    threadId,
    signals,
    liveEligible,
    onModelChanged: model.handleRemoteChange,
  })
  const { events, steps, outputs, loaded, error, working, channel, sendLive, chooseModel } = source
  const { sending, send, retryBoot } = useSend()
  const rightPanel = useRightPanel()
  const pullRequests = usePullRequests({ threadId, channel, thread: thread.data })
  const spawnerId = spawnerIdOf(thread.data)
  const parentTitle = useParentTitle(spawnerId)
  const [draft, setDraft] = useState('')
  const images = useComposerAttachments()

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
  const view = useMemo(
    () => transcriptViewOf({ durable, live, outputs, reveal }),
    [durable, live, outputs, reveal],
  )
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
  const rewindPoints = useMemo(() => new Set(userRewindPoints(parsed).keys()), [parsed])
  const rewind = useRewind({
    situation: () => ({
      threadId,
      events: parsed,
      live: source.live,
      working,
      podState: pod?.state ?? null,
    }),
    source,
    onRestore: (restored) => setDraft((current) => restoredDraftOf({ current, restored })),
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
      handoff.begin(sent)
      source.refreshEvents()
      refresh()
    },
  })
  const handleModelChange = (next: ModelSelection) =>
    void model.handleChange({ next, chooseLive: chooseModel })
  const handleRetryBoot = async () => {
    await retryBoot(threadId)
    refresh()
  }
  const handleStop = () => {
    if (source.interrupt()) return
    toast.error('Could not reach the sandbox to stop the turn')
  }

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
          {error !== null && !loaded ? (
            <div className="mx-auto w-full max-w-3xl px-4 pt-4">
              <Alert variant="destructive">
                <AlertTitle>Couldn&apos;t load this thread</AlertTitle>
                <AlertDescription>
                  {error instanceof CloudApiError ? error.message : String(error)}
                </AlertDescription>
              </Alert>
            </div>
          ) : null}
          <ThreadMainSlot
            footer={
              <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
                {notConfigured === null ? null : <NotConfiguredAlert error={notConfigured.error} />}
                {operator.request === null ? null : (
                  <OperatorInputCard
                    key={operator.request.requestId}
                    request={operator.request}
                    submitting={operator.submitting}
                    onSubmit={(value) => void operator.handleSubmit(value)}
                  />
                )}
                <RewindDialog
                  pick={rewind.pick}
                  applying={rewind.applying}
                  onCancel={rewind.handleCancel}
                  onConfirm={() => void rewind.handleConfirm()}
                />
                <ComposerDock dock={dock} />
                <ThreadComposer
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
                >
                  <ModelPickerControls
                    picker={model.picker}
                    selection={model.selection}
                    onSelectionChange={handleModelChange}
                    open={commands.modelOpen}
                    onOpenChange={commands.setModelOpen}
                  />
                  <ComposerContext usage={dock.usage} />
                </ThreadComposer>
              </div>
            }
          >
            <ThreadTranscript
              items={view.items}
              failure={view.failure}
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
