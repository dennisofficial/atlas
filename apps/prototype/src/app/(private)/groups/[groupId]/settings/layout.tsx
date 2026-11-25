import { Suspense, type ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { groupById } from '@/features/groups/fixtures/groups'
import { GroupSettingsLayout } from '@/features/groups/group-settings-layout'

export default async function GroupSettingsRouteLayout({
  params,
  children,
}: {
  params: Promise<{ groupId: string }>
  children: ReactNode
}) {
  const { groupId } = await params
  if (groupById(groupId) === null) notFound()
  return (
    <GroupSettingsLayout groupId={groupId}>
      <Suspense>{children}</Suspense>
    </GroupSettingsLayout>
  )
}
