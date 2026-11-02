'use client'

import { useMemo, type ReactNode } from 'react'

import type { PreviewLinkRoute } from '../data/preview-ports'
import type { RosterChannel } from '../data/roster-source'
import { usePreviews } from '../data/use-previews'
import { PreviewsProvider } from './previews-context'
import { ERightTab } from './right-tab'
import type { RightPanelState } from './use-right-panel'

export function ThreadPreviewsProvider(props: {
  channel: RosterChannel | null
  rightPanel: RightPanelState
  children: ReactNode
}) {
  const { channel, rightPanel, children } = props
  const { setTab, setSheetOpen } = rightPanel
  const { ports, selectedId, src, select, openUrl } = usePreviews(channel)
  const value = useMemo(() => {
    const handleOpenUrl = (route: PreviewLinkRoute) => {
      openUrl(route)
      setTab(ERightTab.Preview)
      setSheetOpen(true)
    }
    return { ports, selectedId, src, select, openUrl: handleOpenUrl }
  }, [ports, selectedId, src, select, openUrl, setTab, setSheetOpen])
  return <PreviewsProvider value={value}>{children}</PreviewsProvider>
}
