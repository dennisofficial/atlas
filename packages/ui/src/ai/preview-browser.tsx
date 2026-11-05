'use client'

import type { ReactNode } from 'react'

import { PreviewDeviceMenu } from './internal/preview-device-menu'
import { EStageFit, type PreviewBrowserTab } from './internal/preview-browser-types'
import { PreviewStage, useStageSize } from './internal/preview-stage'
import { PreviewTabStrip } from './internal/preview-tab-strip'
import { PreviewToolbar } from './internal/preview-toolbar'
import { availableSpace, fitViewport, type Viewport } from './internal/viewport'

export { EStageFit, type PreviewBrowserTab } from './internal/preview-browser-types'
export { EPreviewStatus, PREVIEW_STATUS_LABEL, type PreviewPort } from './preview-ports'
export {
  EViewportKind,
  FULL_VIEWPORT,
  VIEWPORT_PRESETS,
  availableSpace,
  clampDimension,
  fitViewport,
  formatViewportParam,
  formatZoom,
  parseViewportParam,
  rotateViewport,
  type Size,
  type Viewport,
  type ViewportFit,
  type ViewportPreset,
} from './internal/viewport'

export interface PreviewBrowserProps {
  tabs: PreviewBrowserTab[]
  activeId?: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onOpen: () => void
  address: string
  canGoBack: boolean
  canGoForward: boolean
  canReload: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onAddress: (input: string) => void
  viewport: Viewport
  onViewportChange: (viewport: Viewport) => void
  stageFit: EStageFit
  children: ReactNode
}

export function PreviewBrowser({
  tabs,
  activeId,
  onActivate,
  onClose,
  onOpen,
  address,
  canGoBack,
  canGoForward,
  canReload,
  onBack,
  onForward,
  onReload,
  onAddress,
  viewport,
  onViewportChange,
  stageFit,
  children,
}: PreviewBrowserProps) {
  const stage = useStageSize()
  const fit = fitViewport({
    viewport,
    available: availableSpace({ viewport, container: stage.size }),
  })
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PreviewTabStrip
        tabs={tabs}
        activeId={activeId}
        onActivate={onActivate}
        onClose={onClose}
        onOpen={onOpen}
      />
      <PreviewToolbar
        activeId={activeId}
        address={address}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canReload={canReload}
        onBack={onBack}
        onForward={onForward}
        onReload={onReload}
        onAddress={onAddress}
        deviceMenu={
          <PreviewDeviceMenu
            viewport={viewport}
            fit={fit}
            stageFit={stageFit}
            onChange={onViewportChange}
          />
        }
      />
      <PreviewStage stageRef={stage.ref} viewport={viewport} fit={fit} stageFit={stageFit}>
        {children}
      </PreviewStage>
    </div>
  )
}
