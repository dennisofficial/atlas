'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { activeAgentCount } from '../data/agents-model'
import { livePreviewCount } from '../data/preview-ports'
import { useAgents } from '../data/use-agents'
import { usePreviews } from '../data/use-previews'
import { useSubscriptions } from '../data/use-subscriptions'
import { AgentsTab } from './agents-tab'
import { ChangesTab } from './changes-tab'
import { FilesTab } from './files-tab'
import { PreviewTab } from './preview-tab'
import { ProcessesTab } from './processes-tab'
import { ERightTab, isRightTab, TAB_LABEL } from './right-tab'
import { SubscriptionsTab } from './subscriptions-tab'
import { TerminalTab } from './terminal-tab'
import { useThreadPanel } from './thread-panel-context'

export type RightPanelProps = {
  tab: ERightTab
  onTabChange: (tab: ERightTab) => void
}

const TAB_BODY: Record<
  Exclude<ERightTab, ERightTab.Agents | ERightTab.Subscriptions | ERightTab.Preview>,
  () => React.JSX.Element
> = {
  [ERightTab.Changes]: ChangesTab,
  [ERightTab.Files]: FilesTab,
  [ERightTab.Terminal]: TerminalTab,
  [ERightTab.Processes]: ProcessesTab,
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
  if (props.tab === ERightTab.Agents) return <AgentsTab data={props.agents} />
  if (props.tab === ERightTab.Subscriptions) return <SubscriptionsTab data={props.subscriptions} />
  if (props.tab === ERightTab.Preview) return <PreviewTab data={props.previews} />
  return bodyOf(props.tab)
}

export function RightPanel({ tab, onTabChange }: RightPanelProps) {
  const { threadId, channel, working } = useThreadPanel()
  const agents = useAgents({ threadId, channel, working })
  const running = activeAgentCount(agents.agents)
  const subscriptions = useSubscriptions({ threadId, channel })
  const watching = subscriptions.subscriptions.length
  const previews = usePreviews(channel)
  const serving = livePreviewCount(previews.ports)
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
                {value === ERightTab.Subscriptions && watching > 0 ? (
                  <span className="font-mono text-xs tabular-nums">{watching}</span>
                ) : null}
                {value === ERightTab.Preview && serving > 0 ? (
                  <span className="font-mono text-xs tabular-nums">{serving}</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
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
