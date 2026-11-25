'use client'

import type { ReactNode } from 'react'

import { useRouteParam } from '@/lib/route-param'

import { GroupSettingsLayout } from './group-settings-layout'

export function GroupSettingsRoute({ children }: { children: ReactNode }) {
  const groupId = useRouteParam('groupId')
  return <GroupSettingsLayout groupId={groupId}>{children}</GroupSettingsLayout>
}
