import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import type { ChannelConnection, ChannelReload, RemoteDeltaChannel } from './remote-delta-channel'
import { ECloudSandboxState, type WorkspaceSpec } from './sandbox-client'
import type { SettleWaitNotice, RuntimeCheckpoint } from '@dltech/atlas-wire'
import type { SessionActivityPort } from '../activity/port'
import type { TurnLedgerPort } from '../ledger/turn-ledger.port'
import type { ThreadStorePort } from '../store/thread-store'

export { ECloudSandboxState }
export type { WorkspaceSpec }

export enum EResizeApplies {
  Live = 'live',
  Restart = 'restart',
}

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
    /** The cloud project the sandbox clones from on boot. `null` boots an empty workspace. */
    projectId: string | null
    /** The thread's model ref, written into the boot spec so the cloud session runs the model it was on. */
    model?: string | undefined
    birth?: { effort: string } | undefined
    /** Fires the moment the wake finds a protocol-mismatched sandbox and starts rotating it. */
    onRotationStarted?: (() => void) | undefined
    /**
     * The mount is riding out a provider settle — a sandbox name the registry has not released
     * yet. Lets the caller narrate the wait rather than sit silent.
     */
    onSettleWait?: ((notice: SettleWaitNotice) => void) | undefined
  }): Promise<CloudSandbox>
  find(args: {
    threadId: ThreadId
    signal?: AbortSignal | undefined
  }): Promise<CloudSandboxStatus | undefined>
  /** The live allocation as the provider reports it; fields absent when the provider doesn't say. */
  readResources(args: { threadId: ThreadId }): Promise<{ vcpus?: number; memoryMb?: number }>
  /** Resizes the live sandbox. Touches the running sandbox only — never the stored default. */
  updateResources(args: {
    threadId: ThreadId
    vcpus: number
  }): Promise<{ appliesAt: EResizeApplies }>
  destroy(args: {
    threadId: ThreadId
    expectedSandboxSessionId?: string | undefined
  }): Promise<void>
}

export type CloudStores = {
  log: EventLogPort
  threads: ThreadStorePort
  ledger: TurnLedgerPort
  activity: SessionActivityPort
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
