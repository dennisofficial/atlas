import { EMPTY_DETAILS } from '@/features/threads/panel/details/details-input'
import type { ThreadPanelValue } from '@/features/threads/panel/thread-panel-context'

const noop = () => undefined

export const panelValueOf = (args: { sessionId: string; working: boolean }): ThreadPanelValue => ({
  threadId: args.sessionId,
  channel: null,
  pod: null,
  details: EMPTY_DETAILS,
  loaded: true,
  error: null,
  working: args.working,
  changesPath: undefined,
  agentId: undefined,
  contextPath: undefined,
  filePath: undefined,
  openChanges: noop,
  openAgent: noop,
  openDetails: noop,
  clearAgent: noop,
  openContextFile: noop,
  toggleContextFile: noop,
  closeContextFile: noop,
  openFile: noop,
  closeFile: noop,
  closePanel: noop,
  refreshPod: noop,
})
