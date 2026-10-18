import type { EventDraft, SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'
import type { PendingEntryWire, PrStateWire, RosterWire, RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { DeltaChannel, Unsubscribe } from '../channel/delta-channel'
import { EStepEnd } from '../channel/signal'
import type { TurnOutcome } from '../loop/turn-outcome'
import type { EClientRequest } from './channel-wire'
import type { ConnectionView } from './connection-view'

export type ChannelConnection = ConnectionView

export type ChannelReload = { sinceEventSeq: number }

export type ChannelFailure = { message: string }

/** What the serve said about itself at greet — whether the turn it was running survived, and whether it vouches the client's durable log is whole. */
export type ChannelReady = { turnInFlight: boolean; transcriptCurrent?: boolean | undefined }

/** The far side received the interrupt frame and aborted the turn it was driving. */
export type InterruptAck = { turnInFlight: boolean }

export type ThreadRenamedFrame = { threadId: ThreadId; title: string }

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
    context?: readonly EventDraft[] | undefined
  }): void
  run(args?: { resume?: boolean }): void
  interrupt(): void
  pause(): void
  resume(): void
  syncSettings(args: { content: string }): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  connection(): ChannelConnection
  onConnection(listener: (connection: ChannelConnection) => void): Unsubscribe
  onReload(listener: (reload: ChannelReload) => void): Unsubscribe
  onReady(listener: (ready: ChannelReady) => void): Unsubscribe
  onInterruptAck(listener: (ack: InterruptAck) => void): Unsubscribe
  onRoster(listener: (roster: RosterWire) => void): Unsubscribe
  onPrStates(listener: (states: readonly PrStateWire[]) => void): Unsubscribe
  pendingEntries(): readonly PendingEntryWire[]
  onPendingChanged(listener: (entries: readonly PendingEntryWire[]) => void): Unsubscribe
  onThreadRenamed(listener: (renamed: ThreadRenamedFrame) => void): Unsubscribe
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
