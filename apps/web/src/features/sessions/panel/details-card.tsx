'use client'

import { GitCompareIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { useIsMobile } from '@dltech/atlas-ui/hooks/use-mobile'

import { ChangeTotalsLabel } from './change-totals-label'

import { SessionDetailsTab } from './details-tab'

export type SessionDetailsCardProps = {
  open: boolean
  onOpenChanges: () => void
}

const DETAILS_CARD_RESERVE = '@min-[64rem]:pr-[21.5rem]'

export const detailsCardReserveOf = (shown: boolean): string => (shown ? DETAILS_CARD_RESERVE : '')

export function SessionDetailsCard({ open, onOpenChanges }: SessionDetailsCardProps) {
  const isMobile = useIsMobile()

  if (!open || isMobile) return null

  return (
    <div
      data-session-details-card
      className="pointer-events-none absolute inset-y-3 right-3 z-10 hidden w-80 flex-col @min-[64rem]:flex"
    >
      <div className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-border">
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
