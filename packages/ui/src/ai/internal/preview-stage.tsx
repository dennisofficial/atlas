import { useEffect, useState, type ReactNode } from 'react'

import { cn } from '#lib/utils'
import { EViewportKind, type Size, type Viewport, type ViewportFit } from './viewport'

const DEVICE_FRAME = 'shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-border'
const CONTENT_SLOT = 'preview-stage-content'
const DEVICE_SLOT = 'preview-stage-device'

export function useStageSize() {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return { ref: setElement, size }
}

interface StageBodyProps {
  viewport: Viewport
  fit: ViewportFit
  children: ReactNode
}

function StageBody({ viewport, fit, children }: StageBodyProps) {
  const content = (
    <div data-slot={CONTENT_SLOT} className="size-full">
      {children}
    </div>
  )
  if (viewport.kind === EViewportKind.Full) return <div className="absolute inset-0">{content}</div>
  const size = { width: viewport.width, height: viewport.height }
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        data-slot={DEVICE_SLOT}
        style={{ width: fit.width * fit.scale, height: fit.height * fit.scale }}
        className={DEVICE_FRAME}
      >
        <div style={{ ...size, transform: `scale(${fit.scale})`, transformOrigin: 'top left' }}>
          {content}
        </div>
      </div>
    </div>
  )
}

export interface PreviewStageProps extends StageBodyProps {
  stageRef: (element: HTMLDivElement | null) => void
}

export function PreviewStage({ stageRef, viewport, fit, children }: PreviewStageProps) {
  const full = viewport.kind === EViewportKind.Full
  return (
    <div
      ref={stageRef}
      className={cn('relative min-h-0 flex-1 overflow-hidden', !full && 'bg-muted/40')}
    >
      <StageBody viewport={viewport} fit={fit}>
        {children}
      </StageBody>
    </div>
  )
}
