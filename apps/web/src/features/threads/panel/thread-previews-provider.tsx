'use client'

import { useMemo, type ReactNode } from 'react'

import type { RosterChannel } from '../data/roster-source'
import { usePreviews } from '../data/use-previews'
import { PreviewsProvider } from './previews-context'
import { ERightTab } from './right-tab'
import type { RightPanelState } from './use-right-panel'

export function ThreadPreviewsProvider(props: {
  threadId: string
  channel: RosterChannel | null
  rightPanel: RightPanelState
  children: ReactNode
}) {
  const { threadId, channel, rightPanel, children } = props
  const { setTab, setSheetOpen } = rightPanel
  const { ports, loaded, openUrl } = usePreviews({ channel, threadId })
  const value = useMemo(() => {
    const handleOpenUrl = (url: string) => {
      openUrl(url)
      setTab(ERightTab.Preview)
      setSheetOpen(true)
    }
    return { ports, loaded, openUrl: handleOpenUrl }
  }, [ports, loaded, openUrl, setTab, setSheetOpen])
  return <PreviewsProvider value={value}>{children}</PreviewsProvider>
}
