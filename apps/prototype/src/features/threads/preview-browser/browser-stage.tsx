import { useEffect, useState, type ReactNode } from 'react'

import { cn } from '@dltech/atlas-ui/lib/utils'

import { EViewportKind, type Size, type Viewport, type ViewportFit } from '@/proto/fit-viewport'

const DEVICE_FRAME = 'shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-border'

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

function StageBody(props: {
  viewport: Viewport
  fit: ViewportFit
  native: boolean
  children: ReactNode
}) {
  const { viewport, fit, native, children } = props
  if (viewport.kind === EViewportKind.Full)
    return <div className="absolute inset-0">{children}</div>
  const size = { width: viewport.width, height: viewport.height }
  if (native) {
    return (
      <div className="flex min-h-full w-full min-w-fit p-4">
        <div style={size} className={cn('m-auto', DEVICE_FRAME)}>
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        style={{ width: fit.width * fit.scale, height: fit.height * fit.scale }}
        className={DEVICE_FRAME}
      >
        <div style={{ ...size, transform: `scale(${fit.scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export function BrowserStage(props: {
  stageRef: (element: HTMLDivElement | null) => void
  viewport: Viewport
  fit: ViewportFit
  native: boolean
  children: ReactNode
}) {
  const { stageRef, viewport, fit, native, children } = props
  const full = viewport.kind === EViewportKind.Full
  return (
    <div
      ref={stageRef}
      className={cn(
        'relative min-h-0 flex-1',
        !full && 'bg-muted/40',
        !full && native ? 'overflow-auto' : 'overflow-hidden',
      )}
    >
      <StageBody viewport={viewport} fit={fit} native={native}>
        {children}
      </StageBody>
    </div>
  )
}
