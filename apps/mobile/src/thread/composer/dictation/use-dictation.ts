import * as Haptics from 'expo-haptics'
import { useCallback, useReducer, useRef } from 'react'
import { type SharedValue, useSharedValue, withTiming } from 'react-native-reanimated'

import {
  EDictationEvent,
  type IDictationEngine,
  type IDictationSession,
  type TDictationEvent,
} from './dictation-engine'
import {
  dictationReducerOf,
  EDictationAction,
  EDictationStatus,
  INITIAL_DICTATION_STATE,
  isDictatingOf,
} from './dictation-state'
import { smoothedLevelOf } from './level-smoothing'
import type { ITranscript } from './transcript-model'
import {
  emptyWaveformOf,
  type IWaveformHistory,
  pushWaveformLevel,
  waveformOrderOf,
} from './waveform-history'

const HISTORY_STEP_MS = 55

const RELEASE_MS = 240

export interface IDictation {
  active: boolean
  transcript: ITranscript
  error: string | null
  level: SharedValue<number>
  history: SharedValue<readonly number[]>
  start: () => void
  stop: () => void
  cancel: () => void
}

const hapticOf = () => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

export const useDictation = ({ engine }: { engine: IDictationEngine }): IDictation => {
  const [state, dispatch] = useReducer(dictationReducerOf, INITIAL_DICTATION_STATE)
  const level = useSharedValue(0)
  const history = useSharedValue<readonly number[]>(waveformOrderOf(emptyWaveformOf()))
  const sessionRef = useRef<IDictationSession | null>(null)
  const stopPendingRef = useRef(false)
  const discardRef = useRef(false)
  const clockRef = useRef({ level: 0, history: 0 })
  const waveformRef = useRef<IWaveformHistory>(emptyWaveformOf())
  const statusRef = useRef(state.status)
  statusRef.current = state.status

  const release = useCallback(() => {
    level.value = withTiming(0, { duration: RELEASE_MS })
  }, [level])

  const handleEvent = useCallback(
    (event: TDictationEvent) => {
      if (event.type === EDictationEvent.Level) {
        const now = Date.now()
        const smoothed = smoothedLevelOf({
          previous: level.value,
          target: event.level,
          elapsedMs: now - clockRef.current.level,
        })
        clockRef.current.level = now
        level.value = smoothed
        if (now - clockRef.current.history >= HISTORY_STEP_MS) {
          clockRef.current.history = now
          waveformRef.current = pushWaveformLevel({ history: waveformRef.current, level: smoothed })
          history.value = waveformOrderOf(waveformRef.current)
        }
        return
      }
      dispatch({ type: EDictationAction.Event, event })
      if (event.type === EDictationEvent.Ended || event.type === EDictationEvent.Error) release()
    },
    [history, level, release],
  )

  const start = useCallback(() => {
    if (statusRef.current !== EDictationStatus.Idle) return
    dispatch({ type: EDictationAction.Start })
    hapticOf()
    stopPendingRef.current = false
    discardRef.current = false
    clockRef.current = { level: Date.now(), history: 0 }
    waveformRef.current = emptyWaveformOf()
    history.value = waveformOrderOf(waveformRef.current)
    void engine.start({ onEvent: handleEvent }).then((session) => {
      if (discardRef.current) {
        session.cancel()
        return
      }
      sessionRef.current = session
      if (!stopPendingRef.current) return
      stopPendingRef.current = false
      void session.stop()
    })
  }, [engine, handleEvent, history])

  const stop = useCallback(() => {
    if (statusRef.current === EDictationStatus.Idle) return
    dispatch({ type: EDictationAction.Stop })
    hapticOf()
    const session = sessionRef.current
    sessionRef.current = null
    if (session === null) {
      stopPendingRef.current = true
      return
    }
    void session.stop()
  }, [])

  const cancel = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    stopPendingRef.current = false
    discardRef.current = session === null
    session?.cancel()
    dispatch({ type: EDictationAction.Reset })
    release()
  }, [release])

  return {
    active: isDictatingOf(state),
    transcript: state.transcript,
    error: state.error,
    level,
    history,
    start,
    stop,
    cancel,
  }
}
