import { pullRequestDisplayOf } from '@dltech/atlas-plugin-github/core'
import { FastForward, type LucideIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@dltech/atlas-ui/components/tooltip'

export type PullRequestMergeMarkerValue = {
  icon: LucideIcon
  hint: string
}

type MergeMarked = {
  state: string | undefined
  mergeQueued?: boolean | undefined
  autoMerge?: boolean | undefined
}

export function mergeMarkerOf(entry: MergeMarked): PullRequestMergeMarkerValue | undefined {
  const display = pullRequestDisplayOf(entry)
  if (!display.autoMerge) return undefined
  return { icon: FastForward, hint: 'Auto-merge enabled' }
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
