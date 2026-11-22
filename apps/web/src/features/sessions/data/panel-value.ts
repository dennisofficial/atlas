import { EMPTY_DETAILS } from '@/features/threads/panel/details/details-input'
import type { ThreadPanelValue } from '@/features/threads/panel/thread-panel-context'

const noop = () => undefined

export const panelValueOf = (args: {
  sessionId: string
  working: boolean
  agentId: string | undefined
  parentAgentId?: string | undefined
  openAgent: (agentId: string, parentAgentId?: string) => void
  clearAgent: () => void
}): ThreadPanelValue => ({
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
  openChanges: noop,
  openAgent: args.openAgent,
  openDetails: noop,
  clearAgent: args.clearAgent,
  openContextFile: noop,
  toggleContextFile: noop,
  closeContextFile: noop,
  openFile: noop,
  closeFile: noop,
  closePanel: noop,
  refreshPod: noop,
})
