'use client'

import { Tabs, TabsContent } from '@dltech/atlas-ui/components/tabs'

import { SessionDetailsTab } from './details-tab'
import { PaneEmptyBody } from './pane-empty-body'
import { ESessionPaneTab, isSessionPaneTab } from './pane-tab'
import { PaneTabStrip } from './pane-tab-strip'

export type SessionPaneProps = {
  tab: ESessionPaneTab
  onTabChange: (tab: ESessionPaneTab) => void
  tabBarClassName?: string
}

export function SessionPane({ tab, onTabChange, tabBarClassName }: SessionPaneProps) {
  const handleTabChange = (value: unknown) => {
    if (isSessionPaneTab(value)) onTabChange(value)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card">
      <Tabs value={tab} onValueChange={handleTabChange} className="min-h-0 flex-1">
        <PaneTabStrip className={tabBarClassName} counts={{}} />
        {Object.values(ESessionPaneTab).map((value) => (
          <TabsContent key={value} value={value} className="min-h-0 flex-1 overflow-auto">
            {value === ESessionPaneTab.Details ? (
              <SessionDetailsTab />
            ) : (
              <PaneEmptyBody tab={value} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
