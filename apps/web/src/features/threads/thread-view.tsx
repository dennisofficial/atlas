'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { FileQuestionIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, useCloudQuery } from '@/lib/use-cloud-query'

import { bootViewOf, isPodFailed, isPodLiveEligible } from './data/boot-view'
import { TOO_LATE_NOTICE } from './data/composer-queue'
import { notConfiguredOf } from './data/not-configured'
import {
  awaitingRunOf,
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
import { transcriptViewOf } from './data/transcript'
import { useComposerDock } from './data/use-composer-dock'
import { useNow } from './data/use-now'
import { usePodStatus } from './data/use-pod-status'
import { messageOf, useSend } from './data/use-send'
import { useThreadModel } from './data/use-thread-model'
import { useThreadSource } from './data/use-thread-source'
import { ComposerContext, ComposerDock } from './composer-dock'
import { ModelPickerControls } from './model-picker'
import { NotConfiguredAlert } from './not-configured-alert'
import { isBootStarting } from './sandbox-boot-props'
import { ThreadComposer } from './thread-composer'
import { ThreadTranscript } from './thread-transcript'

const NOT_FOUND = 404
const STARTING_PLACEHOLDER = 'The sandbox is starting — you can keep typing…'

function ThreadMissing() {
  return (
    <Empty className="m-auto max-w-sm border py-10">
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

function ThreadHeader({ title, failed }: { title: string | null; failed: boolean }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        {title === null ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <h1 className="truncate text-sm font-medium">{title}</h1>
        )}
        {failed ? <Badge variant="destructive">Failed</Badge> : null}
      </div>
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/threads/new" />}>
        <PlusIcon />
        New thread
      </Button>
    </header>
  )
}

export function ThreadView({ threadId }: { threadId: string }) {
  const thread = useCloudQuery({ key: threadId, load: () => fetchThread(threadId) })
  const [liveEligible, setLiveEligible] = useState(false)
  const model = useThreadModel({ threadId, stored: thread.data?.model })
  const source = useThreadSource({
    threadId,
    liveEligible,
    onModelChanged: model.handleRemoteChange,
  })
  const { events, signals, outputs, loaded, error, working, sendLive, chooseModel } = source
  const { sending, send, retryBoot } = useSend()
  const [draft, setDraft] = useState('')
  const [takenBack, setTakenBack] = useState<ReadonlySet<string>>(() => new Set())

  const visible = useMemo(
    () => withoutTakenBack({ events, sendIds: takenBack }),
    [events, takenBack],
  )
  const view = useMemo(
    () => transcriptViewOf({ events: eventsFromWire(visible), signals, outputs }),
    [visible, signals, outputs],
  )
  const dock = useComposerDock({
    visible,
    source,
    picker: model.picker,
    selection: model.selection,
    onRestore: (restored) => setDraft((current) => restoredDraftOf({ current, restored })),
  })
  const awaitingRun = useMemo(() => awaitingRunOf(visible), [visible])
  const { pod, refresh } = usePodStatus({ threadId, awaitingRun })
  const eligibleNow = isPodLiveEligible(pod)
  if (eligibleNow !== liveEligible) setLiveEligible(eligibleNow)
  const probe = bootViewOf({ pod, now: 0 })
  const now = useNow(isBootStarting(probe))
  const boot = useMemo(() => bootViewOf({ pod, now }), [pod, now])
  const notConfigured = useMemo(() => notConfiguredOf(pod), [pod])

  const handleSubmit = async (text: string) => {
    const sent = await send({ threadId, text, liveSend: sendLive })
    if (!sent) setDraft(text)
    else refresh()
  }
  const handleModelChange = (next: ModelSelection) =>
    void model.handleChange({ next, chooseLive: chooseModel })
  const handleRetryBoot = async () => {
    await retryBoot(threadId)
    refresh()
  }
  const handleEscape = async () => {
    const target = takeBackTargetOf({ events: visible, podState: pod?.state ?? null })
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader title={title} failed={failed} />
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
          boot={boot}
          working={working}
          onRetryBoot={() => void handleRetryBoot()}
        />
      </div>
      <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
        {notConfigured === null ? null : (
          <NotConfiguredAlert error={notConfigured.error} gap={notConfigured.gap} />
        )}
        <ComposerDock dock={dock} />
        <ThreadComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={handleSubmit}
          onEscape={() => void handleEscape()}
          disabled={sending}
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
    </div>
  )
}
