import { useState } from 'react'

import {
  AgentsPanel,
  type AgentsPanelAgent,
  type AgentsPanelTeammate,
  runningAgentCount,
} from '@dltech/atlas-ui/ai/agents-panel'
import { ChangesPanel, type ChangeScopeOption } from '@dltech/atlas-ui/ai/changes-panel'
import { FileTree } from '@dltech/atlas-ui/ai/file-tree'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dltech/atlas-ui/components/tabs'

import { CHANGED_FILES } from '@dltech/atlas-ui/fixtures/agent'
import { CHANGE_SCOPES, filesInScope } from './session-changes'
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
  teammates: AgentsPanelTeammate[]
  detailId?: string
  onDetailChange: (id: string | undefined) => void
  onOpenTeammate: (id: string) => void
  onJumpToSpawn: (id: string) => void
}

const TAB_LABEL: Record<ERightTab, string> = {
  [ERightTab.Agents]: 'Agents',
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
  teammates,
  detailId,
  onDetailChange,
  onOpenTeammate,
  onJumpToSpawn,
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
            {value === ERightTab.Agents && running > 0 ? (
              <span className="font-mono text-xs tabular-nums">{running}</span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={ERightTab.Agents} className="min-h-0 flex-1">
        <AgentsPanel
          agents={agents}
          teammates={teammates}
          detailId={detailId}
          onDetailChange={onDetailChange}
          onOpenTeammate={onOpenTeammate}
          onJumpToSpawn={onJumpToSpawn}
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
