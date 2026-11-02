import { ChatItem } from '@dltech/atlas-ui/ai/chat'
import { Skeleton } from '@dltech/atlas-ui/components/skeleton'

import { DetailsSection } from '../details/section'

const CREW_ROWS = [
  { title: 'w-32', state: 'w-8' },
  { title: 'w-24', state: 'w-10' },
  { title: 'w-40', state: 'w-8' },
]

export function CrewLoading() {
  return (
    <div role="status" aria-label="Loading agents">
      <DetailsSection title="Sub-agents" count={<Skeleton className="h-3 w-6" />}>
        {CREW_ROWS.map((row, index) => (
          <div key={index} className="flex min-h-7 w-full min-w-0 items-center gap-2 px-1 py-1">
            <span className="flex size-4 shrink-0 items-center justify-center">
              <Skeleton className="size-3.5 rounded-full" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex h-5 items-center justify-between gap-2">
                <Skeleton className={`h-4 ${row.title}`} />
                <Skeleton className={`h-3 shrink-0 ${row.state}`} />
              </span>
              <span className="flex h-4 items-center">
                <Skeleton className="h-3 w-28" />
              </span>
            </span>
          </div>
        ))}
      </DetailsSection>
    </div>
  )
}

export function TranscriptLoading() {
  return (
    <div
      role="status"
      aria-label="Loading transcript"
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
    >
      <ChatItem id="loading-user">
        <div className="flex justify-end">
          <Skeleton className="h-9 w-2/3 rounded-2xl" />
        </div>
      </ChatItem>
      <ChatItem id="loading-agent">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </ChatItem>
    </div>
  )
}
