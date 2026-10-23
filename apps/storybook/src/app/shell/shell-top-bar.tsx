import { ArrowLeft, ArrowRight, Plus, Search } from 'lucide-react'

import { Avatar, AvatarBadge, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Button } from '@dltech/atlas-ui/components/button'
import { SidebarHeader } from '@dltech/atlas-ui/components/sidebar'

import { USER } from '../../fixtures/app'
import { AtlasMark } from './atlas-mark'
import { RowAction } from './shell-row-action'

export function ShellTopBar() {
  return (
    <SidebarHeader className="flex-row items-center gap-1 px-2 py-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-2">
      <AtlasMark className="mx-1 size-4 shrink-0 text-primary" />
      <div className="flex items-center group-data-[collapsible=icon]:hidden">
        <RowAction label="Back">
          <ArrowLeft />
        </RowAction>
        <RowAction label="Forward">
          <ArrowRight />
        </RowAction>
      </div>
      <Avatar size="sm" className="ml-auto group-data-[collapsible=icon]:hidden">
        <AvatarFallback>{USER.initials}</AvatarFallback>
        <AvatarBadge className="bg-success" />
      </Avatar>
      <div className="group-data-[collapsible=icon]:hidden">
        <RowAction label="Search">
          <Search />
        </RowAction>
      </div>
      <Button size="icon-xs" aria-label="New thread" className="size-6 rounded-full">
        <Plus />
      </Button>
    </SidebarHeader>
  )
}
