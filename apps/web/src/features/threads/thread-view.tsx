'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { FileQuestionIcon, PlusIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@dltech/atlas-ui/components/alert'
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

import { clearPendingSend, usePendingSend } from './data/pending-sends'
import { fetchThread } from './data/threads-api'
import { bootViewOf, isSendDelivered, transcriptOf, withPendingSend } from './data/transcript'
import { useNow } from './data/use-now'
import { useSend } from './data/use-send'
import { useThreadEvents } from './data/use-thread-events'
import { NotConfiguredAlert } from './not-configured-alert'
import { isBootStarting } from './sandbox-boot-props'
import { ThreadComposer } from './thread-composer'
import { ThreadTranscript } from './thread-transcript'

const NOT_FOUND = 404
const STARTING_PLACEHOLDER = 'The sandbox is starting…'
const UNTITLED = 'Untitled thread'

function ThreadMissing() {
  return (
    <Empty className="m-auto max-w-sm border py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileQuestionIcon />
        </EmptyMedia>
        <EmptyTitle>Thread not found</EmptyTitle>
        <EmptyDescription>It may have been deleted, or it belongs to another account.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ThreadHeader({ title }: { title: string | null }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
      {title === null ? (
        <Skeleton className="h-4 w-48" />
      ) : (
        <h1 className="truncate text-sm font-medium">{title}</h1>
      )}
      <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/threads/new" />}>
        <PlusIcon />
        New thread
      </Button>
    </header>
  )
}

export function ThreadView({ threadId }: { threadId: string }) {
  const thread = useCloudQuery({ key: threadId, load: () => fetchThread(threadId) })
  const { events, loaded, error } = useThreadEvents(threadId)
  const pending = usePendingSend(threadId)
  const { sending, notConfigured, send, retryBoot } = useSend()
  const [draft, setDraft] = useState('')

  const delivered = useMemo(() => transcriptOf(events), [events])
  const awaitingDelivery = pending !== undefined && !isSendDelivered({ items: delivered, pending })
  const items = useMemo(() => withPendingSend({ items: delivered, pending }), [delivered, pending])
  const probe = bootViewOf({ events, now: 0 })
  const now = useNow(isBootStarting(probe))
  const boot = useMemo(() => bootViewOf({ events, now }), [events, now])

  useEffect(() => {
    if (pending !== undefined && !awaitingDelivery) clearPendingSend(threadId)
  }, [pending, awaitingDelivery, threadId])

  const handleSubmit = async (text: string) => {
    const sent = await send({ threadId, text })
    if (!sent) setDraft(text)
  }
  const handleRetryBoot = () => void retryBoot(threadId)

  if (thread.state === EQueryState.Failed && thread.error.status === NOT_FOUND) {
    return <ThreadMissing />
  }

  const starting = isBootStarting(boot)
  const title =
    thread.state === EQueryState.Loading ? null : (thread.data?.title ?? UNTITLED)

  return (
    <div className="flex h-dvh flex-col">
      <ThreadHeader title={title} />
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
        <ThreadTranscript items={items} boot={boot} onRetryBoot={handleRetryBoot} />
      </div>
      <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
        {notConfigured === null ? null : <NotConfiguredAlert error={notConfigured} />}
        <ThreadComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={handleSubmit}
          disabled={sending || starting || awaitingDelivery}
          placeholder={starting ? STARTING_PLACEHOLDER : undefined}
        />
      </div>
    </div>
  )
}
