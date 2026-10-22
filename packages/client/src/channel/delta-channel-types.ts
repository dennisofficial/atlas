import type { CallId, ChunkFilter, Event, ThreadId } from '@dltech/atlas-core'

import type { ChannelSignal, EStepEnd, OperatorInputRequest, RetryWaitingSignal } from './signal'

export type ChannelListener = (signal: ChannelSignal) => void

export type ListenerErrorSink = (cause: unknown) => void

export type Unsubscribe = () => void

export type ThreadPublisher = {
  readonly threadId: ThreadId
  readonly onChunk: ChunkFilter
  toolOutput(args: { callId: CallId; text: string }): void
  eventsAppended(args?: { onListenerError?: ListenerErrorSink }): void
  settleAppend(args: { events: readonly Event[] }): void
  close(args: { end: EStepEnd }): void
  retrying(notice: Omit<RetryWaitingSignal, 'type'>): void
  turnWorking(args: { working: boolean }): void
  operatorInput(args: {
    open: OperatorInputRequest | null
    onListenerError?: ListenerErrorSink
  }): void
}

export type DeltaChannel = {
  subscribe(args: { threadId: ThreadId; listener: ChannelListener }): Unsubscribe
  snapshot(args: { threadId: ThreadId }): readonly ChannelSignal[]
  publisherFor(args: { threadId: ThreadId; filter?: ChunkFilter | undefined }): ThreadPublisher
}
