'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { activeAgentCount } from '../data/agents-model'
import { useAgents } from '../data/use-agents'
import { AgentsTab } from './agents-tab'
import { ChangesTab } from './changes-tab'
import { FilesTab } from './files-tab'
import { PreviewTab } from './preview-tab'
import { ERightTab, isRightTab, TAB_LABEL } from './right-tab'
import { TerminalTab } from './terminal-tab'
import { useThreadPanel } from './thread-panel-context'

export type RightPanelProps = {
  tab: ERightTab
  onTabChange: (tab: ERightTab) => void
}

const TAB_BODY: Record<Exclude<ERightTab, ERightTab.Agents>, () => React.JSX.Element> = {
  [ERightTab.Changes]: ChangesTab,
  [ERightTab.Files]: FilesTab,
  [ERightTab.Terminal]: TerminalTab,
  [ERightTab.Preview]: PreviewTab,
}

function bodyOf(tab: Exclude<ERightTab, ERightTab.Agents>): React.JSX.Element {
  const Body = TAB_BODY[tab]
  return <Body />
}

export function RightPanel({ tab, onTabChange }: RightPanelProps) {
  const { threadId, channel, working } = useThreadPanel()
  const agents = useAgents({ threadId, channel, working })
  const running = activeAgentCount(agents.agents)
  const handleTabChange = (value: unknown) => {
    if (isRightTab(value)) onTabChange(value)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card">
      <Tabs value={tab} onValueChange={handleTabChange} className="min-h-0 flex-1">
        <div className="flex h-10 shrink-0 items-end overflow-x-auto border-b px-3">
          <TabsList variant="line" className="justify-start">
            {Object.values(ERightTab).map((value) => (
              <TabsTrigger key={value} value={value} className="flex-none">
                {TAB_LABEL[value]}
                {value === ERightTab.Agents && running > 0 ? (
                  <span className="font-mono text-xs tabular-nums">{running}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {Object.values(ERightTab).map((value) => (
          <TabsContent key={value} value={value} className="min-h-0 flex-1 overflow-auto">
            {value === ERightTab.Agents ? <AgentsTab data={agents} /> : bodyOf(value)}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
