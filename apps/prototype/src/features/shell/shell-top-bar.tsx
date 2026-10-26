import { Plus, Search } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'
import { Kbd } from '@dltech/atlas-ui/components/kbd'
import { SidebarHeader } from '@dltech/atlas-ui/components/sidebar'

export function ShellTopBar() {
  return (
    <SidebarHeader className="flex-row items-center gap-1.5 p-2 group-data-[collapsible=icon]:flex-col">
      <button
        type="button"
        aria-label="Search threads and projects"
        className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-sidebar-border px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:px-0"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="truncate group-data-[collapsible=icon]:hidden">Search</span>
        <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
      </button>
      <Button
        size="icon-xs"
        aria-label="New thread"
        nativeButton={false}
        render={<Link href="/threads/new" />}
        className="size-7 shrink-0 rounded-md"
      >
        <Plus />
      </Button>
    </SidebarHeader>
  )
}
