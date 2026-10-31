import { Info } from 'lucide-react'
import { useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@dltech/atlas-ui/components/hover-card'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@dltech/atlas-ui/components/popover'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { ThreadDetails, type ThreadDetailsProps } from './thread-details'

export function ThreadHoverCard({
  className,
  children,
  actions,
  hasDisclosure = false,
  ...details
}: ThreadDetailsProps & {
  className?: string
  children: ReactNode
  actions?: ReactNode
  hasDisclosure?: boolean
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const previewDismissed = useRef(false)
  const detailsButton = useRef<HTMLButtonElement>(null)
  const detailsId = useId()
  const handlePreviewChange = (next: boolean) => {
    if (next && (detailsOpen || previewDismissed.current)) return
    setPreviewOpen(next)
  }
  const handleDetailsChange = (next: boolean) => {
    previewDismissed.current = true
    setPreviewOpen(false)
    setDetailsOpen(next)
  }
  const handleFocus = (event: FocusEvent) => {
    if (detailsOpen || event.target === detailsButton.current) return
    previewDismissed.current = false
    setPreviewOpen(true)
  }
  const handleMouseLeave = () => {
    previewDismissed.current = false
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    previewDismissed.current = true
    setPreviewOpen(false)
    event.stopPropagation()
  }
  return (
    <Popover open={detailsOpen} onOpenChange={handleDetailsChange}>
      <HoverCard open={previewOpen && !detailsOpen} onOpenChange={handlePreviewChange}>
        <HoverCardTrigger
          delay={350}
          closeDelay={100}
          render={
            <fieldset
              aria-label={details.thread.title ?? 'Thread'}
              className={className}
              onFocus={handleFocus}
              onMouseLeave={handleMouseLeave}
              onKeyDown={handleKeyDown}
            />
          }
        >
          {children}
          <div
            className={cn(
              'absolute top-1 flex items-center opacity-0 pointer-events-none group-hover/thread:opacity-100 group-hover/thread:pointer-events-auto group-focus-within/thread:opacity-100 group-focus-within/thread:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto group-data-[collapsible=icon]:hidden',
              hasDisclosure ? 'right-10' : 'right-1',
            )}
          >
            {actions}
            <PopoverTrigger
              ref={detailsButton}
              aria-label="Thread details"
              aria-controls={detailsId}
              render={
                <button
                  type="button"
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                />
              }
            >
              <Info className="size-3.5" />
            </PopoverTrigger>
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={8}
          alignOffset={-6}
          className="w-80 max-w-full"
        >
          <ThreadDetails {...details} />
        </HoverCardContent>
      </HoverCard>
      <PopoverContent
        id={detailsId}
        side="right"
        align="start"
        sideOffset={8}
        alignOffset={-6}
        finalFocus={detailsButton}
        className="w-80 max-w-full"
        aria-label="Thread details"
      >
        <PopoverTitle className="sr-only">Thread details</PopoverTitle>
        <ThreadDetails {...details} />
      </PopoverContent>
    </Popover>
  )
}
