export type PurgeConfirmRow = {
  id: string
  label: string
}

export type PurgeConfirmState = {
  running: boolean
  rows: readonly PurgeConfirmRow[]
}

const MOVES: readonly PurgeConfirmRow[] = [
  { id: 'accounts', label: 'model accounts and their credentials' },
  { id: 'secrets', label: 'secrets' },
  { id: 'mcp', label: 'MCP servers' },
  { id: 'memory', label: 'your memory' },
  { id: 'github', label: 'your GitHub connection (deleted, not moved)' },
]

export function openPurgeConfirm(): PurgeConfirmState {
  return { running: false, rows: MOVES }
}

export function runningPurgeConfirm(state: PurgeConfirmState): PurgeConfirmState {
  return { ...state, running: true }
}
