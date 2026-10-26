export enum ESessionState {
  Running = 'running',
  Idle = 'idle',
  ApprovalPending = 'approval-pending',
}

export enum ERightTab {
  Agents = 'agents',
  Changes = 'changes',
  Files = 'files',
  Terminal = 'terminal',
  Preview = 'preview',
}

const RIGHT_TABS: string[] = Object.values(ERightTab)

export function isRightTab(value: unknown): value is ERightTab {
  return typeof value === 'string' && RIGHT_TABS.includes(value)
}

export enum EDotTone {
  Live = 'live',
  Pending = 'pending',
  Idle = 'idle',
}
