import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { isKnownThreadId } from '@/features/threads/thread-ids'
import { ThreadRoute } from '@/features/threads/thread-route'

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  if (!isKnownThreadId(threadId)) notFound()
  return (
    <Suspense>
      <ThreadRoute threadId={threadId} />
    </Suspense>
  )
}
