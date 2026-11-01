import { Plus, Search } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@dltech/atlas-ui/components/button'
import { Kbd } from '@dltech/atlas-ui/components/kbd'
import { SidebarHeader } from '@dltech/atlas-ui/components/sidebar'

import { AtlasMark } from './atlas-mark'
import { ShellDisplayOptions } from './shell-display-options'

function DesktopWordmark() {
  return (
    <div data-desktop-wordmark="" className="items-center gap-2 text-sidebar-foreground">
      <AtlasMark aria-hidden="true" className="size-6 text-primary" />
      <span className="font-display text-lg font-semibold tracking-tight">Atlas</span>
    </div>
  )
}

export function ShellTopBar({ onSearch }: { onSearch: () => void }) {
  return (
    <SidebarHeader>
      <DesktopWordmark />
      <div className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col">
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search threads and projects"
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-sidebar-border px-2 text-sm text-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:px-0"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">Search</span>
          <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘K</Kbd>
        </button>
        <ShellDisplayOptions />
        <Button
          size="icon-sm"
          aria-label="New thread"
          nativeButton={false}
          render={<Link href="/threads/new" />}
          className="shrink-0"
        >
          <Plus />
        </Button>
      </div>
    </SidebarHeader>
  )
}
