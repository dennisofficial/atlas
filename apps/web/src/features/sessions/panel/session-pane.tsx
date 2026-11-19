'use client'

import { Tabs, TabsContent } from '@dltech/atlas-ui/components/tabs'

import { ChangesTab } from '@/features/sessions/changes/changes-tab'
import { openPageCount } from '@/features/threads/data/preview-browser/browser-model'
import { usePreviewBrowser } from '@/features/threads/data/preview-browser/use-preview-browser'

import { BrowserTab } from './browser/browser-tab'
import { FilesTab } from '../files/files-tab'
import { TerminalTab } from '../terminal/terminal-tab'
import { SessionDetailsTab } from './details-tab'
import { PaneEmptyBody } from './pane-empty-body'
import { ESessionPaneTab, isSessionPaneTab } from './pane-tab'
import { PaneTabStrip } from './pane-tab-strip'
import { useSessionPaneValue } from './pane-value'
import { previewPortsOf } from './preview-ports'

export type SessionPaneProps = {
  tab: ESessionPaneTab
  onTabChange: (tab: ESessionPaneTab) => void
  tabBarClassName?: string
}

function PaneBody({ tab }: { tab: ESessionPaneTab }) {
  const { sessionId, view, viewLoaded } = useSessionPaneValue()
  if (tab === ESessionPaneTab.Details) return <SessionDetailsTab />
  if (tab === ESessionPaneTab.Changes) return <ChangesTab />
  if (tab === ESessionPaneTab.Files) return <FilesTab />
  if (tab === ESessionPaneTab.Terminal) return <TerminalTab />
  if (tab === ESessionPaneTab.Browser) {
    return (
      <BrowserTab sessionId={sessionId} ports={previewPortsOf(view.previews)} loaded={viewLoaded} />
    )
  }
  return <PaneEmptyBody tab={tab} />
}

export function SessionPane({ tab, onTabChange, tabBarClassName }: SessionPaneProps) {
  const { sessionId } = useSessionPaneValue()
  const openTabs = openPageCount(usePreviewBrowser(sessionId).state)
  const handleTabChange = (value: unknown) => {
    if (isSessionPaneTab(value)) onTabChange(value)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card">
      <Tabs value={tab} onValueChange={handleTabChange} className="min-h-0 flex-1">
        <PaneTabStrip
          className={tabBarClassName}
          counts={{ [ESessionPaneTab.Browser]: openTabs }}
        />
        {Object.values(ESessionPaneTab).map((value) => (
          <TabsContent key={value} value={value} className="min-h-0 flex-1 overflow-auto">
            <PaneBody tab={value} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
