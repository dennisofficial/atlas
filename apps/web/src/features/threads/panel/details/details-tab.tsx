'use client'

import type { AgentsData } from '../../data/use-agents'
import { useContextFiles } from '../../data/use-context-files'
import { useDeclaredServices } from '../../data/use-declared-services'
import { declaredNamesOf } from '../../data/services-model'
import { useProcesses } from '../../data/use-processes'
import type { SubscriptionsData } from '../../data/use-subscriptions'
import type { ERightTab } from '../right-tab'
import { useThreadPanel } from '../thread-panel-context'
import { AgentDrill } from './agent-drill'
import { ContextSection } from './context-section'
import { CrewSection } from './crew-section'
import { DetailsFooter } from './footer'
import { GithubSection } from './github-section'
import { HeadSection } from './head-section'
import { PodSection } from './pod-section'
import { ProcessesSection } from './processes-section'
import { ServicesSection } from './services-section'
import { SubscriptionsSection } from './subscriptions-section'
import { TodoSection } from './todo-section'

export function DetailsTab(props: {
  agents: AgentsData
  subscriptions: SubscriptionsData
  onOpenTab: (tab: ERightTab) => void
  onOpenServiceLog: (serviceId: string) => void
}) {
  const { threadId, channel, agentId } = useThreadPanel()
  const processes = useProcesses({ threadId, channel })
  const declared = useDeclaredServices(channel)
  const context = useContextFiles(channel)
  const drilled = agentId !== undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        {drilled ? (
          <AgentDrill data={props.agents} />
        ) : (
          <>
            <HeadSection />
            <PodSection />
            <GithubSection />
            <ContextSection files={context} />
            <ServicesSection data={declared} onOpenLog={props.onOpenServiceLog} />
            <ProcessesSection
              data={processes}
              declared={declaredNamesOf(declared.view)}
              onOpen={props.onOpenTab}
            />
            <TodoSection />
            <CrewSection data={props.agents} />
            <SubscriptionsSection data={props.subscriptions} />
          </>
        )}
      </div>
      <DetailsFooter />
    </div>
  )
}
