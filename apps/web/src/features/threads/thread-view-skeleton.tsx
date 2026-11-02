import { SidebarTrigger } from '@dltech/atlas-ui/components/sidebar'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { TranscriptLoading } from './panel/agents/agents-skeletons'

const TAB_COUNT = 5

function HeaderSkeleton() {
  return (
    <header
      data-chrome="titlebar"
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-2 md:px-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Open navigation" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="h-5 w-14 rounded-4xl" />
      </div>
    </header>
  )
}

function ComposerSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4">
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="hidden h-full min-h-0 min-w-0 w-1/3 shrink-0 flex-col border-l bg-card md:flex">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        {Array.from({ length: TAB_COUNT }, (_, index) => (
          <Skeleton key={index} className="h-4 w-14" />
        ))}
      </div>
    </div>
  )
}

export function ThreadViewSkeleton() {
  return (
    <div role="status" aria-label="Loading thread" className="flex min-h-0 flex-1 flex-col">
      <HeaderSkeleton />
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <TranscriptLoading />
          </div>
          <ComposerSkeleton />
        </div>
        <PanelSkeleton />
      </div>
    </div>
  )
}
