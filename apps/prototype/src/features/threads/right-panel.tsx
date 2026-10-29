import { useState } from 'react'

import { type AgentsPanelAgent, runningAgentCount } from '@dltech/atlas-ui/ai/agents-panel'
import { ChangesPanel, type ChangeScopeOption } from '@dltech/atlas-ui/ai/changes-panel'
import { FileTree } from '@dltech/atlas-ui/ai/file-tree'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { CHANGED_FILES } from '@dltech/atlas-ui/fixtures/agent'
import { CHANGE_SCOPES, filesInScope } from './session-changes'
import { DetailsTab } from './details/details-tab'
import type { CrewRow } from './details/details-model'
import { PodChanges, PodFiles, PodPreview, PodTerminal } from './pod-panels'
import type { PodPanelState } from './pod-state'
import { ERightTab, isRightTab } from './session-types'
import { PreviewTab } from './preview-tab'
import type { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import { TerminalTab } from './terminal-tab'

export interface RightPanelProps {
  tab: ERightTab
  onTabChange: (tab: ERightTab) => void
  expanded: string[]
  onExpandedChange: (paths: string[]) => void
  initialTerminalConnection?: ETerminalConnection
  initialPreviewId?: string
  pod?: PodPanelState
  agents: AgentsPanelAgent[]
  title: string
  teammates: CrewRow[]
  subagents: CrewRow[]
  detailId?: string
  onDetailChange: (id: string | undefined) => void
  onOpenTeammate: (id: string) => void
  onJumpToSpawn: (id: string) => void
  contextPath?: string
  onOpenContextFile: (path: string) => void
}

const TAB_LABEL: Record<ERightTab, string> = {
  [ERightTab.Details]: 'Details',
  [ERightTab.Changes]: 'Changes',
  [ERightTab.Files]: 'Files',
  [ERightTab.Terminal]: 'Terminal',
  [ERightTab.Preview]: 'Preview',
}

const SCOPES: ChangeScopeOption[] = CHANGE_SCOPES

export function RightPanel({
  tab,
  onTabChange,
  expanded,
  onExpandedChange,
  initialTerminalConnection,
  initialPreviewId,
  pod,
  agents,
  title,
  teammates,
  subagents,
  detailId,
  onDetailChange,
  onOpenTeammate,
  onJumpToSpawn,
  contextPath,
  onOpenContextFile,
}: RightPanelProps) {
  const running = runningAgentCount(agents)
  const [scope, setScope] = useState('all')
  const [selectedFile, setSelectedFile] = useState<string>()

  const handleTabChange = (value: unknown) => {
    if (isRightTab(value)) onTabChange(value)
  }

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="h-full min-h-0 gap-0 bg-card">
      <TabsList
        variant="line"
        className="h-10 w-full shrink-0 justify-start gap-4 border-b border-border px-3"
      >
        {Object.values(ERightTab).map((value) => (
          <TabsTrigger key={value} value={value} className="flex-none px-1">
            {TAB_LABEL[value]}
            {value === ERightTab.Details && running > 0 ? (
              <span className="font-mono text-xs tabular-nums">{running}</span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={ERightTab.Details} className="min-h-0 flex-1">
        <DetailsTab
          title={title}
          agents={agents}
          teammates={teammates}
          subagents={subagents}
          detailId={detailId}
          onDetailChange={onDetailChange}
          onOpenTeammate={onOpenTeammate}
          onJumpToSpawn={onJumpToSpawn}
          contextPath={contextPath}
          onOpenContextFile={onOpenContextFile}
        />
      </TabsContent>
      <TabsContent value={ERightTab.Changes} className="min-h-0 flex-1">
        {pod ? (
          <PodChanges pod={pod} expanded={expanded} onExpandedChange={onExpandedChange} />
        ) : (
          <ChangesPanel
            files={filesInScope(scope)}
            scopes={SCOPES}
            scope={scope}
            onScopeChange={setScope}
            expanded={expanded}
            onExpandedChange={onExpandedChange}
          />
        )}
      </TabsContent>
      <TabsContent
        value={ERightTab.Files}
        className={pod ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto p-2'}
      >
        {pod ? (
          <PodFiles pod={pod} />
        ) : (
          <FileTree nodes={CHANGED_FILES} selected={selectedFile} onSelect={setSelectedFile} />
        )}
      </TabsContent>
      <TabsContent value={ERightTab.Terminal} className="min-h-0 flex-1">
        {pod ? (
          <PodTerminal pod={pod} />
        ) : (
          <TerminalTab initialConnection={initialTerminalConnection} />
        )}
      </TabsContent>
      <TabsContent value={ERightTab.Preview} className="min-h-0 flex-1">
        {pod ? <PodPreview /> : <PreviewTab initialPreviewId={initialPreviewId} />}
      </TabsContent>
    </Tabs>
  )
}
