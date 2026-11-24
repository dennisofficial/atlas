import type { Event, EventOfType, EventRef, ThreadId } from '@dltech/atlas-core'
import {
  EStepEnd,
  toStepId,
  type ChannelListener,
  type ChannelSignal,
  type DeltaChannel,
  type StepId,
} from '@dltech/atlas-client/channel'

import type { SignalFeed } from '../conversation-store-types'

export function channelSignalFeed(args: {
  channel: Pick<DeltaChannel, 'subscribe'>
  threadId: ThreadId
}): SignalFeed {
  return {
    subscribe: (listener) => args.channel.subscribe({ threadId: args.threadId, listener }),
  }
}

/**
 * The publishing half of a delta channel, reduced to what a store spec drives: a step opens on the
 * first chunk, a settled append closes it, and a close ends the step it is given. Replay is not
 * modelled because every spec subscribes before it publishes.
 */
export function createDeltaChannel(): DeltaChannel {
  const listeners = new Set<ChannelListener>()
  let stepId: StepId | undefined
  let started = 0

  const emit = (signal: ChannelSignal): void => {
    for (const listener of [...listeners]) listener(signal)
  }

  const openStep = (): StepId => {
    if (stepId !== undefined) return stepId
    started += 1
    stepId = toStepId(`step-${started}`)
    emit({ type: 'step-started', stepId })
    return stepId
  }

  const endStep = (end: EStepEnd, supersededBy: EventRef | null): void => {
    if (stepId === undefined) return
    emit({ type: 'step-ended', stepId, end, supersededBy })
    stepId = undefined
  }

  const supersedingOf = (events: readonly Event[]): EventRef | null => {
    const durable = events.find(
      (event): event is EventOfType<'assistant-said'> => event.type === 'assistant-said',
    )
    return durable === undefined ? null : { eventId: durable.id, seq: durable.seq }
  }

  return {
    subscribe({ listener }) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    snapshot: () => [],

    publisherFor({ threadId, filter }) {
      return {
        threadId,

        onChunk(chunk) {
          const kept = filter === undefined ? chunk : filter(chunk)
          if (kept === null) return null
          emit({ type: 'chunk', stepId: openStep(), chunk: kept })
          return kept
        },

        toolOutput(args) {
          emit({ type: 'tool-output', callId: args.callId, text: args.text })
        },

        eventsAppended() {
          emit({ type: 'events-appended' })
        },

        settleAppend({ events }) {
          if (stepId === undefined) {
            emit({ type: 'events-appended' })
            return
          }
          endStep(EStepEnd.Completed, supersedingOf(events))
        },

        close({ end }) {
          if (stepId === undefined && end === EStepEnd.Failed) openStep()
          endStep(end, null)
        },

        retrying(notice) {
          endStep(EStepEnd.Retried, null)
          emit({ type: 'retry-waiting', ...notice })
        },

        turnWorking({ working }) {
          emit({ type: 'turn-working', working })
        },

        holdWorking: () => () => undefined,

        operatorInput({ open }) {
          emit({ type: 'operator-input', request: open })
        },
      }
    },
  }
}
