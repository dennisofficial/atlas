import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { SessionRoute } from '@/features/sessions/session-route'
import { isKnownThreadId } from '@/features/threads/thread-ids'

export default async function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  if (!isKnownThreadId(sessionId)) notFound()
  return (
    <Suspense>
      <SessionRoute sessionId={sessionId} />
    </Suspense>
  )
}
