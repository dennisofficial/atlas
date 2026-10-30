'use client'

import type { AgentsData } from '../../data/use-agents'
import { useContextFiles } from '../../data/use-context-files'
import { useDeclaredServices } from '../../data/use-declared-services'
import { declaredNamesOf } from '../../data/services-model'
import { EProcessKind } from '../../data/processes-model'
import { useProcesses } from '../../data/use-processes'
import type { SubscriptionsData } from '../../data/use-subscriptions'
import { useThreadPanel } from '../thread-panel-context'
import { AgentDrill } from './agent-drill'
import { ContextSection } from './context-section'
import { CrewSection } from './crew-section'
import { DetailsFooter } from './footer'
import { GithubSection } from './github-section'
import { HeadSection } from './head-section'
import { PodSection } from './pod-section'
import { ProcessLogSheet } from './process-log-sheet'
import { adhocFoldOf, BackgroundSection } from './processes-sections'
import { ServicesSection } from './services-section'
import { SubscriptionsSection } from './subscriptions-section'
import { TodoSection } from './todo-section'

export function DetailsTab(props: { agents: AgentsData; subscriptions: SubscriptionsData }) {
  const { threadId, channel, agentId } = useThreadPanel()
  const processes = useProcesses({ threadId, channel })
  const declared = useDeclaredServices(channel)
  const context = useContextFiles(channel)
  const adhoc = adhocFoldOf({
    data: processes,
    declared: declaredNamesOf(declared.view),
  })
  const handleOpenServiceLog = (serviceId: string) =>
    processes.handleSelect({ kind: EProcessKind.Service, id: serviceId })
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
            <ServicesSection
              data={declared}
              onOpenLog={handleOpenServiceLog}
              adhoc={{ data: processes, fold: adhoc }}
            />
            <BackgroundSection data={processes} />
            <TodoSection />
            <CrewSection data={props.agents} />
            <SubscriptionsSection data={props.subscriptions} />
          </>
        )}
      </div>
      <ProcessLogSheet data={processes} />
      <DetailsFooter />
    </div>
  )
}
