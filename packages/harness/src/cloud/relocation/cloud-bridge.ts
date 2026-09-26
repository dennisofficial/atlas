import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import type {
  ChannelConnection,
  ChannelReload,
  RemoteDeltaChannel,
} from '../remote-delta-channel'
import { ECloudSandboxState, type WorkspaceSpec } from '../sandbox-client'
import type { TurnLedgerPort } from '../../ledger/turn-ledger.port'
import type { ThreadStorePort } from '../../store/thread-store'

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
  /** The drive the sandbox mounted; the driver always sets it, fakes may omit it. */
  driveName?: string | undefined
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
  create(args: {
    threadId: ThreadId
    workspace: LiftedWorkspace | null
    gpgKey?: string | undefined
    /**
     * Captures the skills/memory tar a fresh boot needs and uploads it through `put`. Deferred so
     * a resume never pays the tar: create invokes it only once the drift probe has settled that
     * the boot is fresh, before boot, so serve finds the archive on its first poll instead of
     * retrying a 404 through its ninety-second budget. The caller owns failure semantics — a lift
     * fails the move on an upload error, a wake warns and continues without the context.
     */
    captureContext?:
      | ((put: (archive: Uint8Array) => Promise<void>) => Promise<void>)
      | undefined
  }): Promise<CloudSandbox>
  /** Operator-session auth, same as `create` — the archive lands on the row `create` just opened. */
  putContext(args: { threadId: ThreadId; archive: Uint8Array }): Promise<void>
  /**
   * The lift's transcript transfer: the tarred session directory, uploaded onto the sandbox row the
   * claim opened. The serve untars it at boot; a resume skips the fetch because the snapshot
   * already carries the directory.
   */
  putTranscript(args: { threadId: ThreadId; archive: Uint8Array }): Promise<void>
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
 * What attaching to a live cloud session hands back: the channel to its serve, and the transcript
 * stores that read over it. The stores are per-attachment because they are backed by the channel —
 * the sandbox owns the transcript while lifted, and there is no control-plane copy left to read.
 */
export type CloudAttachment = {
  channel: CloudChannel
  stores: CloudStores
}

/**
 * Everything a cloud session needs that a local one gets from the composition root. Injected so a
 * spec never opens a socket, and so the concrete clients stay behind one seam.
 */
export type CloudBridge = {
  sandboxes: CloudSandboxes
  attach(args: { threadId: ThreadId; url: string; token: string }): CloudAttachment
}
