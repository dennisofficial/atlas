'use client'

import { GitCompareIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { useIsMobile } from '@dltech/atlas-ui/hooks/use-mobile'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { ChangeTotalsLabel } from './change-totals-label'
import { SessionDetailsTab } from './details-tab'
import { useExitPresence } from './use-exit-presence'

export type SessionDetailsCardProps = {
  open: boolean
  onOpenChanges: () => void
}

const DETAILS_CARD_RESERVE = '@min-[64rem]:pr-[21.5rem]'

export const detailsCardReserveOf = (shown: boolean): string => (shown ? DETAILS_CARD_RESERVE : '')

export function SessionDetailsCard({ open, onOpenChanges }: SessionDetailsCardProps) {
  const isMobile = useIsMobile()
  const presence = useExitPresence<HTMLDivElement>(open)

  if (!presence.mounted || isMobile) return null

  return (
    <div
      data-session-details-card
      data-closing={open ? undefined : true}
      inert={!open}
      className="pointer-events-none absolute inset-y-3 right-3 z-10 hidden w-80 flex-col @min-[64rem]:flex"
    >
      <div
        ref={presence.ref}
        className={cn(
          'flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border duration-200 ease-out motion-reduce:animate-none',
          open
            ? 'pointer-events-auto animate-in fade-in-0 slide-in-from-right-2'
            : 'animate-out fill-mode-forwards fade-out-0 slide-out-to-right-2',
        )}
      >
        <Button
          variant="ghost"
          data-details-changes
          className="mx-2 mt-2 shrink-0 justify-start"
          onClick={onOpenChanges}
        >
          <GitCompareIcon aria-hidden />
          <span className="flex-1 text-left">Changes</span>
          <ChangeTotalsLabel withFiles />
        </Button>
        <SessionDetailsTab />
      </div>
    </div>
  )
}
