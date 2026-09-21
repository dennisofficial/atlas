import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import {
  ECloudSandboxState,
  type ChannelConnection,
  type ChannelReload,
  type RemoteDeltaChannel,
  type ThreadStorePort,
  type TurnLedgerPort,
  type WireSandbox,
  type WireSandboxStatus,
  type WorkspaceSpec,
} from '@dltech/atlas-harness'

export { ECloudSandboxState }

/**
 * What the sandbox rebuilds the workspace from. `null` is a session with no repository behind it,
 * which the control plane accepts by being told nothing rather than by being told nulls.
 */
export type LiftedWorkspace = WorkspaceSpec

export type CloudSandbox = WireSandbox

export type CloudSandboxStatus = WireSandboxStatus

export type CloudSandboxes = {
  create(args: {
    threadId: ThreadId
    workspace: LiftedWorkspace | null
    contextBundle?: string | undefined
  }): Promise<CloudSandbox>
  find(args: { threadId: ThreadId }): Promise<CloudSandboxStatus | undefined>
}

export type CloudStores = {
  log: EventLogPort
  threads: ThreadStorePort
  ledger: TurnLedgerPort
}

export type CloudConnection = ChannelConnection

export type CloudReload = ChannelReload

export type CloudChannel = RemoteDeltaChannel

/**
 * Everything a cloud session needs that a local one gets from the composition root. Injected so a
 * spec never opens a socket, and so the concrete clients stay behind one seam.
 */
export type CloudBridge = {
  stores: CloudStores
  sandboxes: CloudSandboxes
  attach(args: { threadId: ThreadId; url: string; token: string }): CloudChannel
}
