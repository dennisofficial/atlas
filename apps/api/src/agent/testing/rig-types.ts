import type { FaultProxy } from '@dltech/atlas-host/testing'

import type { ToolGate } from './gated-tools'
import type { EHostFault } from './host-faults'

export type HostProcess = {
  label: string
  dbProxy?: FaultProxy
  daemonProxy?: FaultProxy
  kill(signal: 'SIGKILL' | 'SIGTERM'): void
  pause(): void
  resume(): void
  exited: Promise<number>
  logs(): string[]
}

export type ReadEvent = { seq: number; type: string; event: unknown }

export type PanelBeats = { stop(): Promise<void> }

export type HostKnobs = {
  appendRetryMs?: number
  drainCapMs?: number
  pingMs?: number
  poolMax?: number
  noRing?: boolean
  queryTimeoutMs?: number
  toolOutputFile?: string
  sweepMs?: number
  fault?: EHostFault
  pluginToolGate?: ToolGate
  plugins?: boolean
  modelRequestsFile?: string
  contextMirrorDir?: string
  notifyLog?: boolean
  podResizeLog?: boolean
}
