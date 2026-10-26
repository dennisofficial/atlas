'use client'

import { useEffect, useRef, useState } from 'react'

import { ETheme } from './bridge-messages'
import { ChromeThemeProvider } from './chrome-theme'
import { availableSpace, fitViewport, type Viewport } from './fit-viewport'
import { FrameStage } from './frame-stage'
import { chromeUrl } from './frame-path'
import { PageSidebar } from './page-sidebar'
import type { TreeNode } from './page-tree'
import { TopStrip } from './top-strip'
import { TweaksPanel } from './tweaks-panel'
import { cn } from './ui/utils'
import { useElementSize } from './use-element-size'
import { useFrameBridge } from './use-frame-bridge'
import { describeViewport, formatViewportParam, parseViewportParam } from './viewport-param'

export function ProtoChrome({
  tree,
  initialPath,
  initialViewport,
}: {
  tree: TreeNode[]
  initialPath: string
  initialViewport: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { ref: stageRef, size } = useElementSize<HTMLDivElement>()
  const [frameSrc, setFrameSrc] = useState(initialPath)
  const [viewport, setViewport] = useState<Viewport>(() => parseViewportParam(initialViewport))
  const [theme, setTheme] = useState(ETheme.Dark)
  const themeClass = theme === ETheme.Light ? 'proto-chrome light' : 'proto-chrome'
  const bridge = useFrameBridge({ iframeRef, initialPath, theme })
  const { currentPath, navigate } = bridge

  const fit = fitViewport({
    viewport,
    available: availableSpace({ viewport, container: size }),
  })

  useEffect(() => {
    const url = chromeUrl({ path: currentPath, viewport: formatViewportParam(viewport) })
    window.history.replaceState(null, '', url)
  }, [currentPath, viewport])

  const handleSelect = (url: string) => {
    if (url === currentPath) return
    setFrameSrc(url)
    navigate(url)
  }

  return (
    <ChromeThemeProvider value={themeClass}>
      <div
        className={cn(
          themeClass,
          'flex h-svh w-full overflow-hidden bg-background text-foreground',
        )}
      >
        <PageSidebar tree={tree} currentPath={currentPath} onSelect={handleSelect} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TopStrip
            currentPath={currentPath}
            theme={theme}
            viewport={viewport}
            summary={describeViewport({ viewport, fit })}
            onThemeChange={setTheme}
            onViewportChange={setViewport}
          />
          <FrameStage
            stageRef={stageRef}
            iframeRef={iframeRef}
            src={frameSrc}
            viewport={viewport}
            fit={fit}
          />
        </main>
        <TweaksPanel
          announced={bridge.announced}
          onChange={bridge.setControl}
          onReset={bridge.resetControls}
        />
      </div>
    </ChromeThemeProvider>
  )
}
