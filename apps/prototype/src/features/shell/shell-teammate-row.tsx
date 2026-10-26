import Link from 'next/link'

import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'
import { SidebarMenuSubButton, SidebarMenuSubItem } from '@dltech/atlas-ui/components/sidebar'

import type { AppTeammate } from './fixtures/teammates'
import { teammateDisplay } from './teammate-display'
import { threadPath } from './thread-href'

export interface TeammateRowProps {
  teammate: AppTeammate
  active: boolean
}

export function TeammateRow({ teammate, active }: TeammateRowProps) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={active}
        aria-current={active ? 'page' : undefined}
        className="w-full"
        render={<Link href={threadPath(teammate.id)} />}
      >
        <span className="flex shrink-0">
          <AgentStatusIcon display={teammateDisplay(teammate)} className="size-3.5" />
        </span>
        <span>{teammate.title}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}
