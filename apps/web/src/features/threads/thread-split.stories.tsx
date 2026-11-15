import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { EHeaderState } from './data/header-model'
import { EMPTY_DETAILS } from './panel/details/details-input'
import { ThreadPanelProvider, type ThreadPanelValue } from './panel/thread-panel-context'
import { useRightPanel } from './panel/use-right-panel'
import { ThreadHeader } from './thread-header'
import { ThreadLayout } from './thread-layout'

const panel: ThreadPanelValue = {
  threadId: 'story-thread',
  channel: null,
  loaded: true,
  error: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  filePath: undefined,
  openContextFile: () => undefined,
  toggleContextFile: () => undefined,
  closeContextFile: () => undefined,
  openFile: () => undefined,
  closeFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

function StoryThread() {
  const rightPanel = useRightPanel('story-thread')
  return (
    <SidebarProvider className="h-screen">
      <ThreadPanelProvider value={panel}>
        <div className="flex min-h-0 flex-1 flex-col">
          <ThreadHeader
            title="Story thread"
            state={EHeaderState.Idle}
            panelCollapsed={rightPanel.collapsed}
            onOpenPanel={rightPanel.openPanel}
            onTogglePanel={rightPanel.toggleCollapsed}
          />
          <ThreadLayout rightPanel={rightPanel}>
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Transcript
            </div>
          </ThreadLayout>
        </div>
      </ThreadPanelProvider>
    </SidebarProvider>
  )
}

const meta = {
  title: 'Threads/Collapsible right panel',
  parameters: { layout: 'fullscreen' },
}

export default meta

export const CollapsibleRightPanel = {
  render: () => <StoryThread />,
}
