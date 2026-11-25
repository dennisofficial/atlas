import type { RecordEvent } from '../event'

export type FailureMessageState = {
  failureHead: number | null
  prepared: boolean
  afterFailure: boolean
}

export const initialFailureMessage: FailureMessageState = {
  failureHead: null,
  prepared: false,
  afterFailure: false,
}

const ENDS_FAILURE: ReadonlySet<RecordEvent['type']> = new Set([
  'user-said',
  'assistant-said',
  'workspace-prepared',
  'run-failed',
])

export const stepFailureMessage = (
  state: FailureMessageState,
  event: RecordEvent,
): FailureMessageState => {
  switch (event.type) {
    case 'session-start-failed':
      return { failureHead: event.inboxHead, prepared: state.prepared, afterFailure: false }
    case 'workspace-prepare-failed':
      return {
        failureHead: state.prepared ? null : event.inboxHead,
        prepared: state.prepared,
        afterFailure: false,
      }
    case 'workspace-prepared':
      return { failureHead: null, prepared: true, afterFailure: false }
    case 'user-said':
      return { failureHead: null, prepared: true, afterFailure: false }
    case 'input-posted':
      return state.failureHead !== null && event.inboxId > state.failureHead
        ? { ...state, afterFailure: true }
        : state
    default:
      return ENDS_FAILURE.has(event.type)
        ? { failureHead: null, prepared: state.prepared, afterFailure: false }
        : state
  }
}

export const messageAfterFailureOf = (state: FailureMessageState): boolean => state.afterFailure

export const failureMessageOf = (events: readonly RecordEvent[]): FailureMessageState =>
  events.reduce(stepFailureMessage, initialFailureMessage)
