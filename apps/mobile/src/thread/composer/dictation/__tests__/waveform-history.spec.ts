import { describe, expect, it } from 'bun:test'

import {
  emptyWaveformOf,
  isSilentOf,
  pushWaveformLevel,
  WAVEFORM_SILENCE_LEVEL,
  WAVEFORM_SIZE,
  waveformOrderOf,
  waveformReplayOf,
} from '../waveform-history'

const filledWith = ({ size, level }: { size: number; level: number }) => {
  let history = emptyWaveformOf({ size })
  for (let index = 0; index < size; index += 1) history = pushWaveformLevel({ history, level })
  return history
}

describe('emptyWaveformOf', () => {
  it('starts at rest with the default size', () => {
    const history = emptyWaveformOf()
    expect(history.levels).toHaveLength(WAVEFORM_SIZE)
    expect(waveformOrderOf(history).every((level) => level === 0)).toBe(true)
  })
})

describe('pushWaveformLevel', () => {
  it('keeps the history at a fixed size', () => {
    const history = filledWith({ size: 4, level: 0.5 })
    expect(history.levels).toHaveLength(4)
  })

  it('reads oldest first and newest last', () => {
    let history = emptyWaveformOf({ size: 3 })
    history = pushWaveformLevel({ history, level: 0.2 })
    history = pushWaveformLevel({ history, level: 0.6 })
    history = pushWaveformLevel({ history, level: 0.9 })
    expect(waveformOrderOf(history)).toEqual([0.2, 0.6, 0.9])
  })

  it('drops the oldest level once the buffer wraps', () => {
    let history = emptyWaveformOf({ size: 3 })
    for (const level of [0.2, 0.6, 0.9, 0.35]) history = pushWaveformLevel({ history, level })
    expect(waveformOrderOf(history)).toEqual([0.6, 0.9, 0.35])
  })

  it('clamps a level outside zero and one', () => {
    const history = pushWaveformLevel({ history: emptyWaveformOf({ size: 2 }), level: 3 })
    expect(waveformOrderOf(history)).toEqual([0, 1])
  })
})

describe('waveformReplayOf', () => {
  it('replays the newest levels in the count asked for', () => {
    const levels = [0.1, 0.2, 0.3, 0.4, 0.5]
    expect(waveformReplayOf({ levels, count: 3 })).toEqual([0.3, 0.4, 0.5])
  })

  it('pads the left with silence while the history is short', () => {
    expect(waveformReplayOf({ levels: [0.4, 0.5], count: 4 })).toEqual([0, 0, 0.4, 0.5])
  })
})

describe('isSilentOf', () => {
  it('calls a level at or under the silence floor silent', () => {
    expect(isSilentOf(0)).toBe(true)
    expect(isSilentOf(WAVEFORM_SILENCE_LEVEL)).toBe(true)
    expect(isSilentOf(WAVEFORM_SILENCE_LEVEL + 0.01)).toBe(false)
  })
})
