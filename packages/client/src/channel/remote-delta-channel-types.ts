import type { EventDraft, SaidFile, SaidImage, SaidUpload, ThreadId } from '@dltech/atlas-core'
import type {
  CapabilitySet,
  PendingEntryWire,
  PrStateWire,
  RosterWire,
  RuntimeCheckpoint,
  SubscriptionsWire,
  TerminalExitWire,
  TerminalOutputWire,
} from '@dltech/atlas-wire/web'

import type { DeltaChannel, Unsubscribe } from './delta-channel-types'
import { EStepEnd } from './signal'
import type { TurnOutcome } from './turn-outcome'
import type { EClientRequest } from './channel-wire'
import type { ConnectionView } from './connection-view'
import type { ScheduleKeepalive } from './keepalive'
import type { ChannelSocketFactory } from './remote-channel-socket'

export type ChannelConnection = ConnectionView

export type ChannelReload = { sinceEventSeq: number }

export type ChannelFailure = { message: string }

/** What the serve said about itself at greet — whether the turn it was running survived, and whether it vouches the client's durable log is whole. */
export type ChannelReady = { turnInFlight: boolean; transcriptCurrent?: boolean | undefined }

/** The far side received the interrupt frame and aborted the turn it was driving. */
export type InterruptAck = { turnInFlight: boolean }

export type ThreadRenamedFrame = { threadId: ThreadId; title: string }

export type ThreadTitlingFrame = { threadId: ThreadId; titling: boolean }

export type ThreadModelChangedFrame = { threadId: ThreadId; model: { ref: string; effort: string } }

export type SandboxAttachment = { url: string; token: string }

/** Wakes the sandbox; `onRotationStarted` fires when the wake turns out to be a serve swap. */
export type SandboxWake = (wake: { onRotationStarted: () => void }) => Promise<SandboxAttachment>

export const INTERRUPT_ACK_TIMEOUT_MS = 5_000

export const STRANDED_STEP_END = EStepEnd.Detached

export type RemoteDeltaChannel = DeltaChannel & {
  readonly threadId: ThreadId
  send(args: {
    text: string
    requestId?: string | undefined
    images?: readonly SaidImage[] | undefined
    files?: readonly SaidFile[] | undefined
    uploads?: readonly SaidUpload[] | undefined
    context?: readonly EventDraft[] | undefined
  }): void
  run(args?: { resume?: boolean }): void
  interrupt(): void
  pause(): void
  resume(): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  connection(): ChannelConnection
  onConnection(listener: (connection: ChannelConnection) => void): Unsubscribe
  onReload(listener: (reload: ChannelReload) => void): Unsubscribe
  onReady(listener: (ready: ChannelReady) => void): Unsubscribe
  /** What the attached serve advertised on its last Ready; empty until one arrives. */
  capabilities(): CapabilitySet
  onInterruptAck(listener: (ack: InterruptAck) => void): Unsubscribe
  onRoster(listener: (roster: RosterWire) => void): Unsubscribe
  onPrStates(listener: (states: readonly PrStateWire[]) => void): Unsubscribe
  onSubscriptions(listener: (subscriptions: SubscriptionsWire) => void): Unsubscribe
  pendingEntries(): readonly PendingEntryWire[]
  onPendingChanged(listener: (entries: readonly PendingEntryWire[]) => void): Unsubscribe
  onThreadRenamed(listener: (renamed: ThreadRenamedFrame) => void): Unsubscribe
  onThreadTitling(listener: (frame: ThreadTitlingFrame) => void): Unsubscribe
  onThreadModelChanged(listener: (changed: ThreadModelChangedFrame) => void): Unsubscribe
  onTurnEnded(listener: (outcome: TurnOutcome) => void): Unsubscribe
  onError(listener: (failure: ChannelFailure) => void): Unsubscribe
  onServerError(listener: (failure: ChannelFailure) => void): Unsubscribe
  checkpoint?(): RuntimeCheckpoint | null
  onCheckpoint?(listener: (checkpoint: RuntimeCheckpoint) => void): Unsubscribe
  /** Feeds a lifecycle record read out of band (the API status) through the same rules as an in-band checkpoint. */
  observeCheckpoint(checkpoint: RuntimeCheckpoint): void
  detach?(): void
  onDetached?(listener: (reason: string) => void): Unsubscribe
  /** The live attachment coordinates, absent while the channel has never been attached. */
  attachment(): SandboxAttachment | undefined
  /** Dials a fresh attachment; the view reads Waking until its serve greets. */
  wake(args: SandboxAttachment): void
  /** The optimistic Waking signal for the gap before a caller-run wake hands over an attachment. */
  beginWake(): void
  /** A caller-run wake turned out to be a serve swap: the view reads Updating until the wake settles. */
  beginRotation(): void
  /** A caller-run wake failed: the view reads Disconnected with the reason, and waiting requests fail. */
  failWake(args: { reason: string }): void
  /** Runs the injected sandbox wake from any state but a live socket or a wake already under way. */
  reconnect(): void
  /** Sends the far side has not yet acknowledged committing. */
  unackedSendCount(): number
  close(): void
}

export type TerminalFrameChannel = {
  onTerminalOutput(listener: (output: TerminalOutputWire) => void): Unsubscribe
  onTerminalExit(listener: (exit: TerminalExitWire) => void): Unsubscribe
}

export type RemoteDeltaChannelOptions = {
  threadId: ThreadId
  /** Absent means deferred: the view reads Parked and nothing opens until a wake. */
  url?: string | undefined
  token?: string | undefined
  /**
   * The seq of the newest durable event the client holds for the thread, reported on the Hello so
   * the serve can vouch the log is current. A Promise holds the wire until the head resolves so the
   * Hello still leads. Absent means 0.
   */
  lastEventSeq?: (() => number | Promise<number>) | undefined
  socketFactory?: ChannelSocketFactory | undefined
  scheduleRetry?: ((retry: { delayMs: number; run: () => void }) => void) | undefined
  scheduleTimeout?: ((timeout: { delayMs: number; run: () => void }) => void) | undefined
  scheduleKeepalive?: ScheduleKeepalive | undefined
  backoffMs?: ((args: { attempt: number }) => number) | undefined
  maxAttempts?: number | undefined
  requestTimeoutMs?: number | undefined
  unwrittenRequestTimeoutMs?: number | undefined
  keepaliveMs?: number | undefined
  interruptAckTimeoutMs?: number | undefined
  /** Wakes (or re-attaches to) the sandbox through the control plane; the relaunched serve keeps its own turn. */
  wakeSandbox?: SandboxWake | undefined
  onFinished?: (() => void) | undefined
}
