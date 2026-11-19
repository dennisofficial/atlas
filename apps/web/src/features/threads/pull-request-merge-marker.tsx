import { FastForward, type LucideIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

export type PullRequestMergeMarkerValue = {
  icon: LucideIcon
  hint: string
}

/**
 * A queued pull request wears no marker: its icon turns the queued colour instead, as on GitHub.
 * GitHub queues an auto-merge pull request once it is green, so the queue also hides the auto-merge
 * marker that put it there.
 */
type MergeMarked = {
  state: string | undefined
  mergeQueued?: boolean | undefined
  autoMerge?: boolean | undefined
}

export function mergeMarkerOf(entry: MergeMarked): PullRequestMergeMarkerValue | undefined {
  const state = entry.state?.toLowerCase()
  if (state === 'merged' || state === 'closed') return undefined
  if (entry.mergeQueued === true) return undefined
  if (entry.autoMerge === true) {
    return { icon: FastForward, hint: 'Auto-merge enabled' }
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
        <Icon role="img" aria-label={marker.hint} className="size-3" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{marker.hint}</TooltipContent>
    </Tooltip>
  )
}
