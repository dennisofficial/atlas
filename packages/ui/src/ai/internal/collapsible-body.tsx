'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { cn } from 'cn'

import { Button } from '#components/button'

export const COLLAPSED_BODY_HEIGHT_PX = 240

export function CollapsibleBody({ children }: { children: ReactNode }) {
  const bodyId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (content === null) return
    const measure = () => setOverflows(content.offsetHeight > COLLAPSED_BODY_HEIGHT_PX)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const clamped = overflows && !expanded
  const handleToggle = () => setExpanded((previous) => !previous)

  return (
    <div className="flex flex-col gap-1">
      <div
        id={bodyId}
        data-slot="collapsible-body"
        data-clamped={clamped ? '' : undefined}
        className={cn(clamped && 'overflow-hidden mask-b-from-[calc(100%-4rem)]')}
        style={clamped ? { maxHeight: COLLAPSED_BODY_HEIGHT_PX } : undefined}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {overflows ? (
        <div className="flex">
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={handleToggle}
          >
            {expanded ? 'Show less' : 'Show more'}
            {expanded ? (
              <ChevronUpIcon data-icon="inline-end" />
            ) : (
              <ChevronDownIcon data-icon="inline-end" />
            )}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
