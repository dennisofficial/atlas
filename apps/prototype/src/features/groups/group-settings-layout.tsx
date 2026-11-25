'use client'

import type { ReactNode } from 'react'
import { notFound, usePathname } from 'next/navigation'

import { groupById } from './fixtures/groups'
import { EGroupSettingsSection, groupSectionOfPath } from './group-settings-nav'
import { GroupSettingsShell } from './group-settings-shell'

export function GroupSettingsLayout({
  groupId,
  children,
}: {
  groupId: string
  children: ReactNode
}) {
  const group = groupById(groupId)
  const active = groupSectionOfPath(usePathname()) ?? EGroupSettingsSection.Overview
  if (group === null) notFound()
  return (
    <GroupSettingsShell groupId={groupId} group={group} active={active}>
      {children}
    </GroupSettingsShell>
  )
}
