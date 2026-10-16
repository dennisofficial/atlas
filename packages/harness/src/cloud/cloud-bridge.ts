import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { SandboxTransferProgress } from './transfer-progress'

import type {
  ChannelConnection,
  ChannelReload,
  RemoteDeltaChannel,
} from './remote-delta-channel'
import { ECloudSandboxState, type WorkspaceSpec } from './sandbox-client'
import type { SettleWaitNotice, RuntimeCheckpoint } from '@dltech/atlas-wire'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { ThreadStorePort } from '../store/thread-store'

export { ECloudSandboxState }
export type { WorkspaceSpec }

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
  /** The serve version the wake's rotation replaced, when build drift drove the recreate. */
  rotatedFrom?: string | undefined
  /** The wire protocol the sandbox's old serve spoke when this wake rotated it onto the pinned image. */
  rotatedProtocol?: number | undefined
}

/**
 * What the driver's inspect can say: the sandbox's own state and route. The control plane's old
 * `contextPending` is gone — the create result's `created` carries that fact now.
 */
export type CloudSandboxStatus = {
  state: ECloudSandboxState
  url?: string | undefined
  sandboxSessionId?: string | undefined
  checkpoint?: RuntimeCheckpoint | null | undefined
}

export type CloudSandboxes = {
  create(args: {
    threadId: ThreadId
    /** The clone spec: the repo's origin URL. `null` for a session with no repository behind it. */
    workspace: WorkspaceSpec | null
    /** The thread's model ref, written into the boot spec so the cloud session runs the model it was on. */
    model?: string | undefined
    /**
     * Captures the skills/memory tar a fresh boot needs and uploads it through `put`. Deferred so
     * a resume never pays the tar: create invokes it only once the drift probe has settled that
     * the boot is fresh, before boot, so serve finds the archive on its first poll instead of
     * retrying a 404 through its ninety-second budget. The caller owns failure semantics — a birth
     * fails the move on an upload error, a wake warns and continues without the context.
     */
    captureContext?:
      | ((put: (archive: Uint8Array) => Promise<void>) => Promise<void>)
      | undefined
    onTransferProgress?: ((progress: SandboxTransferProgress) => void) | undefined
    /** Fires the moment the wake finds a protocol-mismatched sandbox and starts rotating it. */
    onRotationStarted?: (() => void) | undefined
    /**
     * The mount is riding out a provider settle — a sandbox name the registry has not released
     * yet, or a drive still detaching. Lets the caller narrate the wait rather than sit silent.
     */
    onSettleWait?: ((notice: SettleWaitNotice) => void) | undefined
  }): Promise<CloudSandbox>
  find(args: { threadId: ThreadId }): Promise<CloudSandboxStatus | undefined>
  /** The live allocation as the provider reports it; fields absent when the provider doesn't say. */
  readResources(args: { threadId: ThreadId }): Promise<{ vcpus?: number; memoryMb?: number }>
  /** Resizes the live sandbox. Touches the running sandbox only — never the stored default. */
  updateResources(args: { threadId: ThreadId; vcpus: number }): Promise<void>
  destroy(args: { threadId: ThreadId; expectedSandboxSessionId?: string | undefined }): Promise<void>
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
 * the sandbox owns the transcript while the session runs there, and there is no control-plane copy left to read.
 */
export type CloudAttachment = {
  channel: CloudChannel
  stores: CloudStores
  /**
   * The session-directory mirror keeping the local copy of the cloud session dir current while the
   * channel is open. Absent when the attach opted out (specs, probes). Liveness never reads it —
   * turnInFlight is the channel's answer, not the mirror's.
   */
  sessionMirror?: import('./session-mirror-syncer').SessionMirrorSync | undefined
}

/**
 * Everything a cloud session needs that a local one gets from the composition root. Injected so a
 * spec never opens a socket, and so the concrete clients stay behind one seam.
 */
export type CloudBridge = {
  sandboxes: CloudSandboxes
  /**
   * No `url`/`token` means deferred: a parked channel until `wake` applies an attachment.
   * `sandboxThreadId` overrides the thread whose sandbox hosts the session — a rotation successor
   * shares the predecessor's sandbox, so its wakes and reattachments must resolve that thread's
   * sandbox rather than a successor-named one that was never created.
   */
  attach(args: {
    threadId: ThreadId
    url?: string | undefined
    token?: string | undefined
    sandboxThreadId?: ThreadId | undefined
  }): CloudAttachment
}
