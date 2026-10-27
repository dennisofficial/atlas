'use client'

import { useCallback, useMemo, useState } from 'react'
import { FileQuestionIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { liveSteps } from '@dltech/atlas-client/transcript'

import { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import {
  branchOf,
  headerStateOf,
  pullRequestBadgeOf,
  sandboxSettingsHrefOf,
  spawnerIdOf,
} from './data/header-model'
import { bootViewOf, isPodFailed, isPodLiveEligible } from './data/boot-view'
import { clearedDraftOf } from './data/composer-handoff'
import { TOO_LATE_NOTICE } from './data/composer-queue'
import { notConfiguredOf } from './data/not-configured'
import {
  ETakeBackOutcome,
  restoredDraftOf,
  takeBack,
  takeBackTargetOf,
  withoutTakenBack,
} from './data/take-back'
import type { ModelSelection } from './data/model-selection'
import { fetchThread } from './data/threads-api'
import { UNTITLED } from './data/untitled'
import { eventsFromWire } from './data/events-from-wire'
import { durableTranscriptOf, transcriptViewOf } from './data/transcript'
import { useComposerDock } from './data/use-composer-dock'
import { useComposerHandoff } from './data/use-composer-handoff'
import { useOperatorInput } from './data/use-operator-input'
import { useNow } from './data/use-now'
import { useReveal } from './data/use-reveal'
import { useParentTitle } from './data/use-parent-title'
import { usePodResize } from './data/use-pod-resize'
import { usePodStatus } from './data/use-pod-status'
import { useThreadSignals } from './data/use-thread-signals'
import { messageOf, useSend } from './data/use-send'
import { useThreadModel } from './data/use-thread-model'
import { useThreadSource } from './data/use-thread-source'
import { ComposerContext, ComposerDock } from './composer-dock'
import { ModelPickerControls } from './model-picker'
import { NotConfiguredAlert } from './not-configured-alert'
import { OperatorInputCard } from './operator-input-card'
import { ThreadPanelProvider, type ThreadPanelValue } from './panel/thread-panel-context'
import { useRightPanel } from './panel/use-right-panel'
import { isBootStarting } from './sandbox-boot-props'
import { ThreadComposer } from './thread-composer'
import { ThreadHeader } from './thread-header'
import { ThreadLayout } from './thread-layout'
import { ThreadPodChip } from './thread-pod-chip'
import { ThreadTranscript } from './thread-transcript'

const NOT_FOUND = 404
const STARTING_PLACEHOLDER = 'The sandbox is starting — you can keep typing…'

function ThreadMissing() {
  return (
    <Empty variant="outline" className="m-auto max-w-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <EmptyTitle>Thread not found</EmptyTitle>
        <EmptyDescription>
          It may have been deleted, or it belongs to another account.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function ThreadView({ threadId }: { threadId: string }) {
  const thread = useCloudQuery({
    key: threadId,
    load: () => fetchThread(threadId),
  })
  const [liveEligible, setLiveEligible] = useState(false)
  const model = useThreadModel({ threadId, stored: thread.data?.model })
  const signals = useThreadSignals(threadId)
  const source = useThreadSource({
    threadId,
    signals,
    liveEligible,
    onModelChanged: model.handleRemoteChange,
  })
  const { events, steps, outputs, loaded, error, working, channel, sendLive, chooseModel } = source
  const { sending, send, retryBoot } = useSend()
  const rightPanel = useRightPanel()
  const spawnerId = spawnerIdOf(thread.data)
  const parentTitle = useParentTitle(spawnerId)
  const [draft, setDraft] = useState('')
  const [takenBack, setTakenBack] = useState<ReadonlySet<string>>(() => new Set())

  const visible = useMemo(
    () => withoutTakenBack({ events, sendIds: takenBack }),
    [events, takenBack],
  )
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
    onRestore: (restored) => setDraft((current) => restoredDraftOf({ current, restored })),
  })
  const operator = useOperatorInput(source)
  const handoff = useComposerHandoff({
    events: visible,
    pending: source.pending,
    onSettle: (settled) => setDraft((current) => clearedDraftOf({ current, handoff: settled })),
  })
  const { pod, refresh } = usePodStatus({ threadId, signals })
  const eligibleNow = isPodLiveEligible(pod)
  if (eligibleNow !== liveEligible) setLiveEligible(eligibleNow)
  const probe = bootViewOf({ pod, now: 0 })
  const now = useNow(isBootStarting(probe))
  const boot = useMemo(() => bootViewOf({ pod, now }), [pod, now])
  const notConfigured = useMemo(() => notConfiguredOf(pod), [pod])
  const handleResize = usePodResize({ threadId, refresh })
  const { changesPath, agentId, openChanges, openAgent, clearAgent, setSheetOpen } = rightPanel
  const closePanel = useCallback(() => setSheetOpen(false), [setSheetOpen])
  const panel = useMemo<ThreadPanelValue>(
    () => ({
      threadId,
      channel,
      pod,
      working,
      changesPath,
      agentId,
      openChanges,
      openAgent,
      clearAgent,
      closePanel,
      refreshPod: refresh,
    }),
    [
      threadId,
      channel,
      pod,
      working,
      changesPath,
      agentId,
      openChanges,
      openAgent,
      clearAgent,
      closePanel,
      refresh,
    ],
  )

  const handleSubmit = async (text: string) => {
    const sent = await send({ threadId, text, liveSend: sendLive })
    if (sent === null) return
    handoff.begin(sent)
    source.refreshEvents()
    refresh()
  }
  const handleModelChange = (next: ModelSelection) =>
    void model.handleChange({ next, chooseLive: chooseModel })
  const handleRetryBoot = async () => {
    await retryBoot(threadId)
    refresh()
  }
  const handleEscape = async () => {
    const target = takeBackTargetOf({
      events: visible,
      podState: pod?.state ?? null,
    })
    if (target === null) return
    try {
      const outcome = await takeBack({ threadId, sendId: target.sendId })
      if (outcome === ETakeBackOutcome.TooLate) {
        toast(TOO_LATE_NOTICE)
        return
      }
      setTakenBack((current) => new Set(current).add(target.sendId))
      setDraft((current) => restoredDraftOf({ current, restored: target.text }))
    } catch (failure) {
      toast.error(messageOf(failure))
    }
  }

  if (thread.state === EQueryState.Failed && thread.error.status === NOT_FOUND) {
    return <ThreadMissing />
  }

  const starting = isBootStarting(boot)
  const failed = isPodFailed(pod)
  const title = thread.state === EQueryState.Loading ? null : (thread.data?.title ?? UNTITLED)

  const header = (
    <ThreadHeader
      title={title}
      state={headerStateOf({
        failed,
        working,
        waitingOnOperator: source.waitingOnOperator,
      })}
      parent={spawnerId === undefined ? undefined : { id: spawnerId, title: parentTitle }}
      branch={branchOf(thread.data)}
      pullRequest={pullRequestBadgeOf(thread.data)}
      podChip={
        <ThreadPodChip
          pod={pod}
          working={working}
          onResize={handleResize}
          settingsHref={sandboxSettingsHrefOf(thread.data)}
        />
      }
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
          <div className="min-h-0 flex-1">
            <ThreadTranscript
              items={view.items}
              failure={view.failure}
              pod={pod}
              bootNow={now}
              working={working}
              onRetryBoot={() => void handleRetryBoot()}
            />
          </div>
          <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
            {notConfigured === null ? null : (
              <NotConfiguredAlert error={notConfigured.error} gap={notConfigured.gap} />
            )}
            {operator.request === null ? null : (
              <OperatorInputCard
                key={operator.request.requestId}
                request={operator.request}
                submitting={operator.submitting}
                onSubmit={(value) => void operator.handleSubmit(value)}
              />
            )}
            <ComposerDock dock={dock} />
            <ThreadComposer
              value={draft}
              onValueChange={setDraft}
              onSubmit={handleSubmit}
              onEscape={() => void handleEscape()}
              sending={sending || handoff.waiting}
              placeholder={starting ? STARTING_PLACEHOLDER : dock.placeholder}
            >
              <ModelPickerControls
                picker={model.picker}
                selection={model.selection}
                onSelectionChange={handleModelChange}
              />
              <ComposerContext usage={dock.usage} />
            </ThreadComposer>
          </div>
        </ThreadLayout>
      </div>
    </ThreadPanelProvider>
  )
}
