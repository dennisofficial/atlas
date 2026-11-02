import type { CSSProperties } from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
} from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

const SIDEBAR_STYLE = { '--sidebar-width': '18rem' } as CSSProperties

const PROJECT_SKELETONS = [
  { key: 'first', threads: ['a', 'b', 'c'] },
  { key: 'second', threads: ['a', 'b'] },
]

function ThreadRowSkeleton() {
  return (
    <SidebarMenuItem>
      <div className="flex w-full items-start rounded-md">
        <div className="block min-w-0 flex-1 px-2 py-1.5 text-sm">
          <span className="flex h-5 min-w-0 items-center gap-2">
            <Skeleton className="size-4 shrink-0 rounded-full" />
            <Skeleton className="h-3.5 w-3/5" />
          </span>
          <span className="mt-1 flex h-4 min-w-0 items-center gap-1.5 text-xs">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="ml-auto h-3 w-8 shrink-0" />
          </span>
        </div>
      </div>
    </SidebarMenuItem>
  )
}

function ProjectGroupSkeleton({ threads }: { threads: readonly string[] }) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md px-2">
        <Skeleton className="size-4 shrink-0" />
        <Skeleton className="h-3.5 w-24" />
        <span className="h-px min-w-3 flex-1 bg-sidebar-border" />
      </div>
      <SidebarMenu>
        {threads.map((thread) => (
          <ThreadRowSkeleton key={thread} />
        ))}
      </SidebarMenu>
    </section>
  )
}

export function ThreadsSkeleton() {
  return (
    <SidebarGroup role="status" aria-label="Loading threads">
      <div className="flex flex-col gap-3">
        {PROJECT_SKELETONS.map(({ key, threads }) => (
          <ProjectGroupSkeleton key={key} threads={threads} />
        ))}
      </div>
    </SidebarGroup>
  )
}

function TopBarSkeleton() {
  return (
    <SidebarHeader>
      <div className="flex items-center gap-2">
        <Skeleton className="size-6" />
        <Skeleton className="h-5 w-14" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 min-w-0 flex-1" />
        <Skeleton className="size-7 shrink-0" />
        <Skeleton className="size-7 shrink-0" />
      </div>
    </SidebarHeader>
  )
}

function FooterSkeleton() {
  return (
    <SidebarFooter variant="bordered">
      <div className="flex items-center gap-1">
        <Skeleton className="h-7 flex-1" />
        <Skeleton className="h-7 flex-1" />
      </div>
      <div className="flex h-10 items-center gap-2 px-2">
        <Skeleton className="size-6 shrink-0 rounded-full" />
        <Skeleton className="h-3.5 w-28" />
      </div>
    </SidebarFooter>
  )
}

export function ShellSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <SidebarProvider className="h-svh min-h-0" style={SIDEBAR_STYLE}>
        <Sidebar collapsible="icon">
          <TopBarSkeleton />
          <SidebarContent className="group-data-[collapsible=icon]:hidden">
            <ThreadsSkeleton />
          </SidebarContent>
          <FooterSkeleton />
        </Sidebar>
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:hidden">
            <Skeleton className="size-9" />
            <Skeleton className="h-5 w-16" />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
