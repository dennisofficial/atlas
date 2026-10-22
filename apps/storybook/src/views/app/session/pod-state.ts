import type { ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'
import type { FileNode } from '@dltech/atlas-ui/ai/file-tree'

import { ETerminalConnection, type UserTerminal } from './sandbox-terminal'

export enum EPodPhase {
  None = 'none',
  Starting = 'starting',
  Ready = 'ready',
  Failed = 'failed',
}

export interface PodPanelState {
  phase: EPodPhase
  terminals: UserTerminal[]
  files: FileNode[]
  changedFiles: ChangedFile[]
  onRetry?: () => void
}

export function terminalConnectionOf(phase: EPodPhase): ETerminalConnection | undefined {
  if (phase === EPodPhase.Starting) return ETerminalConnection.Connecting
  if (phase === EPodPhase.Ready) return ETerminalConnection.Connected
  if (phase === EPodPhase.Failed) return ETerminalConnection.Disconnected
  return undefined
}
