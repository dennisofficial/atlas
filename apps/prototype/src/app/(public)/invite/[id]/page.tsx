import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { AUTH_INVITATION_ID } from '@/features/auth/fixtures/auth'
import { InviteRoute } from '@/features/auth/invite-route'
import { PageSpinner } from '@/features/auth/page-spinner'

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (id !== AUTH_INVITATION_ID) notFound()
  return (
    <Suspense fallback={<PageSpinner label="Loading…" />}>
      <InviteRoute />
    </Suspense>
  )
}
