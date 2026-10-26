'use client'

import type { RefObject } from 'react'

import { EViewportKind, type Viewport, type ViewportFit } from './fit-viewport'

export function FrameStage({
  stageRef,
  iframeRef,
  src,
  viewport,
  fit,
}: {
  stageRef: RefObject<HTMLDivElement | null>
  iframeRef: RefObject<HTMLIFrameElement | null>
  src: string
  viewport: Viewport
  fit: ViewportFit
}) {
  const isFull = viewport.kind === EViewportKind.Full
  return (
    <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-muted/40">
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          data-testid="frame-box"
          style={
            isFull ? undefined : { width: fit.width * fit.scale, height: fit.height * fit.scale }
          }
          className={
            isFull
              ? 'size-full'
              : 'shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-border'
          }
        >
          <iframe
            ref={iframeRef}
            title="Prototype page"
            src={src}
            data-testid="proto-frame"
            style={
              isFull
                ? undefined
                : {
                    width: fit.width,
                    height: fit.height,
                    transform: `scale(${fit.scale})`,
                    transformOrigin: 'top left',
                  }
            }
            className={isFull ? 'size-full border-0 bg-background' : 'block border-0 bg-background'}
          />
        </div>
      </div>
    </div>
  )
}
