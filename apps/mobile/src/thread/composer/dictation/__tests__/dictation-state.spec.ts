import { describe, expect, it } from 'bun:test'

import {
  dictationOf,
  EDictationAction,
  EDictationStatus,
  type IDictationState,
  INITIAL_DICTATION_STATE,
  isDictatingOf,
  type TDictationAction,
} from '../dictation-state'
import { EDictationEvent } from '../dictation-engine'

const started = () =>
  dictationOf({ state: INITIAL_DICTATION_STATE, action: { type: EDictationAction.Start } })

const eventOf = (state: IDictationState, action: TDictationAction) => dictationOf({ state, action })

const spoken = (text: string) =>
  eventOf(started(), {
    type: EDictationAction.Event,
    event: { type: EDictationEvent.Partial, text },
  })

describe('dictationOf', () => {
  it('starts from the idle row with no words', () => {
    expect(started()).toEqual({
      status: EDictationStatus.Starting,
      transcript: { committed: '', interim: '' },
      error: null,
    })
  })

  it('ignores a second start while recording', () => {
    const listening = spoken('Open')
    const again = dictationOf({ state: listening, action: { type: EDictationAction.Start } })
    expect(again).toBe(listening)
  })

  it('records on the first partial word', () => {
    expect(spoken('Open a PR')).toEqual({
      status: EDictationStatus.Recording,
      transcript: { committed: '', interim: 'Open a PR' },
      error: null,
    })
  })

  it('commits a final word and clears the interim', () => {
    const state = eventOf(spoken('Open a'), {
      type: EDictationAction.Event,
      event: { type: EDictationEvent.Final, text: 'Open a PR' },
    })
    expect(state.transcript).toEqual({ committed: 'Open a PR', interim: '' })
    expect(state.status).toBe(EDictationStatus.Recording)
  })

  it('keeps the words and the interim while stopping, and commits the last final', () => {
    const stopping = dictationOf({
      state: spoken('and run'),
      action: { type: EDictationAction.Stop },
    })
    expect(stopping.status).toBe(EDictationStatus.Stopping)
    expect(stopping.transcript.interim).toBe('and run')
    const flushed = eventOf(stopping, {
      type: EDictationAction.Event,
      event: { type: EDictationEvent.Final, text: 'and run' },
    })
    expect(flushed.status).toBe(EDictationStatus.Stopping)
    expect(flushed.transcript).toEqual({ committed: 'and run', interim: '' })
  })

  it('returns to idle with the words kept once the engine ends', () => {
    const stopping = dictationOf({
      state: spoken('and run'),
      action: { type: EDictationAction.Stop },
    })
    const done = eventOf(stopping, {
      type: EDictationAction.Event,
      event: { type: EDictationEvent.Ended },
    })
    expect(done.status).toBe(EDictationStatus.Idle)
    expect(done.transcript.interim).toBe('and run')
    expect(isDictatingOf(done)).toBe(false)
  })

  it('shows an engine failure as an error and leaves the row idle', () => {
    const failed = eventOf(started(), {
      type: EDictationAction.Event,
      event: { type: EDictationEvent.Error, message: 'Atlas needs microphone access to dictate.' },
    })
    expect(failed.status).toBe(EDictationStatus.Idle)
    expect(failed.error).toBe('Atlas needs microphone access to dictate.')
  })

  it('ignores a level event', () => {
    const listening = spoken('Open')
    const same = eventOf(listening, {
      type: EDictationAction.Event,
      event: { type: EDictationEvent.Level, level: 0.4 },
    })
    expect(same).toBe(listening)
  })

  it('ignores a partial once idle', () => {
    const same = eventOf(INITIAL_DICTATION_STATE, {
      type: EDictationAction.Event,
      event: { type: EDictationEvent.Partial, text: 'late' },
    })
    expect(same).toBe(INITIAL_DICTATION_STATE)
  })

  it('resets to the idle row with no words', () => {
    const reset = dictationOf({ state: spoken('Open'), action: { type: EDictationAction.Reset } })
    expect(reset).toEqual(INITIAL_DICTATION_STATE)
  })

  it('does not stop twice', () => {
    const idle = dictationOf({
      state: INITIAL_DICTATION_STATE,
      action: { type: EDictationAction.Stop },
    })
    expect(idle).toBe(INITIAL_DICTATION_STATE)
  })
})
