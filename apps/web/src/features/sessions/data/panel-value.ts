import { EMPTY_DETAILS } from '@/features/threads/panel/details/details-input'
import type { ThreadPanelValue } from '@/features/threads/panel/thread-panel-context'

import { EPaneOpen } from '../panel/pane-open'
import { ESessionPaneTab } from '../panel/pane-tab'

const noop = () => undefined

export const panelValueOf = (args: {
  sessionId: string
  working: boolean
  agentId: string | undefined
  parentAgentId?: string | undefined
  openAgent: (agentId: string, parentAgentId?: string) => void
  clearAgent: () => void
  openTab: (tab: ESessionPaneTab) => void
  requestOpen: (request: { kind: EPaneOpen; path: string }) => void
}): ThreadPanelValue => {
  const openPaneFile = (kind: EPaneOpen, path: string) => args.requestOpen({ kind, path })
  return {
    threadId: args.sessionId,
    channel: null,
    pod: null,
    details: EMPTY_DETAILS,
    loaded: true,
    error: null,
    working: args.working,
    changesPath: undefined,
    agentId: args.agentId,
    agentParentId: args.parentAgentId,
    contextPath: undefined,
    filePath: undefined,
    openChanges: (path?: string) =>
      path === undefined
        ? args.openTab(ESessionPaneTab.Changes)
        : openPaneFile(EPaneOpen.Changes, path),
    openAgent: args.openAgent,
    openDetails: noop,
    clearAgent: args.clearAgent,
    openContextFile: (path: string) => openPaneFile(EPaneOpen.Context, path),
    toggleContextFile: (path: string) => openPaneFile(EPaneOpen.Context, path),
    closeContextFile: noop,
    openFile: (path: string) => openPaneFile(EPaneOpen.File, path),
    closeFile: noop,
    closePanel: noop,
    refreshPod: noop,
  }
}
