import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import type { RuntimeCheckpoint, SessionArchiveDescriptor } from '@dltech/atlas-wire'

import type { SandboxTransferProgress, TransferProgress } from '../transfer-progress'

import type {
  ChannelConnection,
  ChannelReload,
  RemoteDeltaChannel,
} from '../remote-delta-channel'
import { ECloudSandboxState, type WorkspaceSpec } from '../sandbox-client'
import type { SettleWaitNotice } from '../vercel-driver-mount'
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
    workspace: LiftedWorkspace | null
    gpgKey?: string | undefined
    /** The thread's model ref, written into the boot spec so the cloud session runs the model it was on. */
    model?: string | undefined
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
    transcriptArchivePath?: string | undefined
    /**
     * A captured workspace archive on this machine, streamed to the drive's bootstrap directory
     * before serve launches, fresh boot or resumed. The path is never serialized into the boot spec.
     */
    workspaceArchivePath?: string | undefined
    workspaceDirectory?: string | undefined
    onTransferProgress?: ((progress: SandboxTransferProgress) => void) | undefined
    /** Fires the moment the wake finds a protocol-mismatched sandbox and starts rotating it. */
    onRotationStarted?: (() => void) | undefined
    /**
     * The mount is riding out a provider settle — a sandbox name the registry has not released
     * yet, or a drive still detaching. Lets the caller narrate the wait rather than sit silent.
     */
    onSettleWait?: ((notice: SettleWaitNotice) => void) | undefined
  }): Promise<CloudSandbox>
  /** Operator-session auth, same as `create` — the archive lands on the row `create` just opened. */
  putContext(args: { threadId: ThreadId; archive: Uint8Array }): Promise<void>
  /**
   * The anti-blank-log gate: after the transcript uploaded, the lift asks the control plane
   * whether the sandbox row reports the session present and non-empty before it flips ownership.
   * The bridge owns how readiness is probed; the lift only reads the verdict.
   */
  confirmLanded(args: { threadId: ThreadId }): Promise<{ landed: boolean }>
  downloadWorkspace?(args: {
    threadId: ThreadId
    path: string
    destination: string
    totalBytes?: number | undefined
    onProgress?: ((progress: TransferProgress) => void) | undefined
  }): Promise<void>
  /** Deletes one serve-prepared export once it has been downloaded or abandoned. */
  releaseWorkspace?(args: { threadId: ThreadId; path: string }): Promise<void>
  downloadSession?(args: {
    threadId: ThreadId
    archive: SessionArchiveDescriptor
    destination: string
    onProgress?: ((progress: TransferProgress) => void) | undefined
  }): Promise<void>
  releaseSession?(args: { threadId: ThreadId; path: string }): Promise<void>
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
  /** No `url`/`token` means deferred: a parked channel until `wake` applies an attachment. */
  attach(args: { threadId: ThreadId; url?: string | undefined; token?: string | undefined }): CloudAttachment
}
