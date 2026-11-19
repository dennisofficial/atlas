import { ListOrdered, Zap, type LucideIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

export type PullRequestMergeMarkerValue = {
  icon: LucideIcon
  label: string
  hint: string
}

/**
 * GitHub queues an auto-merge pull request once it is green, so a queued row would otherwise wear
 * two markers for one wait: the queue outranks the setting that put it there.
 */
type MergeMarked = {
  state: string | undefined
  mergeQueued?: boolean | undefined
  autoMerge?: boolean | undefined
}

export function mergeMarkerOf(entry: MergeMarked): PullRequestMergeMarkerValue | undefined {
  const state = entry.state?.toLowerCase()
  if (state === 'merged' || state === 'closed') return undefined
  if (entry.mergeQueued === true) {
    return { icon: ListOrdered, label: 'Queued', hint: 'In merge queue' }
  }
  if (entry.autoMerge === true) {
    return { icon: Zap, label: 'Auto-merge', hint: 'Auto-merge enabled' }
  }

  return undefined
}

export function PullRequestMergeMarker({ entry }: { entry: MergeMarked }) {
  const marker = mergeMarkerOf(entry)
  if (marker === undefined) return null
  const Icon = marker.icon

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" />
        }
      >
        <Icon aria-hidden className="size-3" />
        {marker.label}
      </TooltipTrigger>
      <TooltipContent side="bottom">{marker.hint}</TooltipContent>
    </Tooltip>
  )
}
