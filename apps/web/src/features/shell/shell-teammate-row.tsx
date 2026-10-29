import Link from 'next/link'

import { AgentStatusIcon } from '@dltech/atlas-ui/ai/agent-status'
import { SidebarMenuSubButton, SidebarMenuSubItem } from '@dltech/atlas-ui/components/sidebar'
import type { WireThread } from '@dltech/atlas-wire/web'

import { UNTITLED } from '@/features/threads/data/untitled'

import { teammateDisplay } from './teammate-display'

export interface TeammateRowProps {
  teammate: WireThread
  active: boolean
}

export function TeammateRow({ teammate, active }: TeammateRowProps) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        isActive={active}
        aria-current={active ? 'page' : undefined}
        className="w-full"
        render={<Link href={`/threads/${encodeURIComponent(teammate.id)}`} />}
      >
        <span className="flex shrink-0">
          <AgentStatusIcon display={teammateDisplay(teammate)} className="size-3.5" />
        </span>
        <span>{teammate.title ?? UNTITLED}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}
