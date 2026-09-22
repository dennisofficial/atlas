import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import {
  ECloudSandboxState,
  type ChannelConnection,
  type ChannelReload,
  type RemoteDeltaChannel,
  type ThreadStorePort,
  type TurnLedgerPort,
  type WorkspaceSpec,
} from '@dltech/atlas-harness'

export { ECloudSandboxState }

/**
 * What the sandbox rebuilds the workspace from. `null` is a session with no repository behind it,
 * which the control plane accepts by being told nothing rather than by being told nulls.
 */
export type LiftedWorkspace = WorkspaceSpec

/**
 * The result of a claim plus a provision: `create` awaits the whole of it, so the url is always
 * there and `created` says whether the sandbox booted fresh (needing the context archive) or
 * resumed from its snapshot.
 */
export type CloudSandbox = {
  url: string
  token: string
  state: ECloudSandboxState
  created: boolean
}

/**
 * What the driver's inspect can say: the sandbox's own state and route. The control plane's old
 * `contextPending` is gone — the create result's `created` carries that fact now.
 */
export type CloudSandboxStatus = {
  state: ECloudSandboxState
  url?: string | undefined
}

export type CloudSandboxes = {
  create(args: { threadId: ThreadId; workspace: LiftedWorkspace | null }): Promise<CloudSandbox>
  /** Operator-session auth, same as `create` — the archive lands on the row `create` just opened. */
  putContext(args: { threadId: ThreadId; archive: Uint8Array }): Promise<void>
  find(args: { threadId: ThreadId }): Promise<CloudSandboxStatus | undefined>
  /**
   * Tears down both halves: the Vercel sandbox through the operator's own token, and the control
   * plane row. Idempotent — descend calls this once the conversation is safely back on the host.
   */
  destroy(args: { threadId: ThreadId }): Promise<void>
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
