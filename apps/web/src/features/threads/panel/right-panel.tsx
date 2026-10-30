'use client'

import { Tabs, TabsContent } from '@dltech/atlas-ui/components/tabs'

import { activeAgentCount } from '../data/agents-model'
import { livePreviewCount } from '../data/preview-ports'
import { useAgents } from '../data/use-agents'
import { usePreviews } from '../data/use-previews'
import { useSubscriptions } from '../data/use-subscriptions'
import { DetailsTab } from './details/details-tab'
import { ChangesTab } from './changes-tab'
import { FilesTab } from './files-tab'
import { PreviewTab } from './preview-tab'
import { ERightTab, isRightTab } from './right-tab'
import { RightTabStrip } from './right-tab-strip'
import { TerminalTab } from './terminal-tab'
import { useThreadPanel } from './thread-panel-context'

export type RightPanelProps = {
  tab: ERightTab
  onTabChange: (tab: ERightTab) => void
  tabBarClassName?: string
}

const TAB_BODY: Record<
  Exclude<ERightTab, ERightTab.Details | ERightTab.Preview>,
  () => React.JSX.Element
> = {
  [ERightTab.Changes]: ChangesTab,
  [ERightTab.Files]: FilesTab,
  [ERightTab.Terminal]: TerminalTab,
}

function bodyOf(tab: keyof typeof TAB_BODY): React.JSX.Element {
  const Body = TAB_BODY[tab]
  return <Body />
}

function TabBody(props: {
  tab: ERightTab
  agents: ReturnType<typeof useAgents>
  subscriptions: ReturnType<typeof useSubscriptions>
  previews: ReturnType<typeof usePreviews>
}) {
  if (props.tab === ERightTab.Details) {
    return <DetailsTab agents={props.agents} subscriptions={props.subscriptions} />
  }
  if (props.tab === ERightTab.Preview) return <PreviewTab data={props.previews} />
  return bodyOf(props.tab)
}

export function RightPanel({ tab, onTabChange, tabBarClassName }: RightPanelProps) {
  const { threadId, channel, working } = useThreadPanel()
  const agents = useAgents({ threadId, channel, working })
  const running = activeAgentCount(agents.agents)
  const subscriptions = useSubscriptions({ threadId, channel })
  const previews = usePreviews(channel)
  const serving = livePreviewCount(previews.ports)
  const handleTabChange = (value: unknown) => {
    if (isRightTab(value)) onTabChange(value)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card">
      <Tabs value={tab} onValueChange={handleTabChange} className="min-h-0 flex-1">
        <RightTabStrip
          className={tabBarClassName}
          counts={{ [ERightTab.Details]: running, [ERightTab.Preview]: serving }}
        />
        {Object.values(ERightTab).map((value) => (
          <TabsContent key={value} value={value} className="min-h-0 flex-1 overflow-auto">
            <TabBody
              tab={value}
              agents={agents}
              subscriptions={subscriptions}
              previews={previews}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
