import { EDictationEvent, type TDictationEvent } from './dictation-engine'
import {
  applyFinalOf,
  applyPartialOf,
  EMPTY_TRANSCRIPT,
  type ITranscript,
} from './transcript-model'

export enum EDictationStatus {
  Idle = 'idle',
  Starting = 'starting',
  Recording = 'recording',
  Stopping = 'stopping',
}

export interface IDictationState {
  status: EDictationStatus
  transcript: ITranscript
  error: string | null
}

export enum EDictationAction {
  Start = 'start',
  Event = 'event',
  Stop = 'stop',
  Reset = 'reset',
}

export type TDictationAction =
  | { type: EDictationAction.Start }
  | { type: EDictationAction.Event; event: TDictationEvent }
  | { type: EDictationAction.Stop }
  | { type: EDictationAction.Reset }

export const INITIAL_DICTATION_STATE: IDictationState = {
  status: EDictationStatus.Idle,
  transcript: EMPTY_TRANSCRIPT,
  error: null,
}

export const isDictatingOf = (state: IDictationState): boolean =>
  state.status !== EDictationStatus.Idle

const listeningStatusOf = (status: EDictationStatus): EDictationStatus =>
  status === EDictationStatus.Stopping ? EDictationStatus.Stopping : EDictationStatus.Recording

const eventStateOf = ({
  state,
  event,
}: {
  state: IDictationState
  event: TDictationEvent
}): IDictationState => {
  switch (event.type) {
    case EDictationEvent.Level:
      return state
    case EDictationEvent.Partial:
      if (state.status === EDictationStatus.Idle) return state
      return {
        ...state,
        status: listeningStatusOf(state.status),
        transcript: applyPartialOf({ transcript: state.transcript, partial: event.text }),
      }
    case EDictationEvent.Final:
      if (state.status === EDictationStatus.Idle) return state
      return {
        ...state,
        status: listeningStatusOf(state.status),
        transcript: applyFinalOf({ transcript: state.transcript, final: event.text }),
      }
    case EDictationEvent.Error:
      return { status: EDictationStatus.Idle, transcript: state.transcript, error: event.message }
    case EDictationEvent.Ended:
      return { ...state, status: EDictationStatus.Idle }
  }
}

export const dictationOf = ({
  state,
  action,
}: {
  state: IDictationState
  action: TDictationAction
}): IDictationState => {
  switch (action.type) {
    case EDictationAction.Start:
      if (state.status !== EDictationStatus.Idle) return state
      return { status: EDictationStatus.Starting, transcript: EMPTY_TRANSCRIPT, error: null }
    case EDictationAction.Event:
      return eventStateOf({ state, event: action.event })
    case EDictationAction.Stop:
      if (state.status === EDictationStatus.Idle) return state
      return { ...state, status: EDictationStatus.Stopping }
    case EDictationAction.Reset:
      return INITIAL_DICTATION_STATE
  }
}

export const dictationReducerOf = (
  state: IDictationState,
  action: TDictationAction,
): IDictationState => dictationOf({ state, action })
