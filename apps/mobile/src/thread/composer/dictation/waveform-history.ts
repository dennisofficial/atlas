import { clampLevel } from './level-smoothing'

export const WAVEFORM_SIZE = 44

export const WAVEFORM_SILENCE_LEVEL = 0.08

export interface IWaveformHistory {
  size: number
  levels: readonly number[]
  next: number
}

export const emptyWaveformOf = ({
  size = WAVEFORM_SIZE,
}: {
  size?: number
} = {}): IWaveformHistory => ({
  size,
  levels: new Array<number>(size).fill(0),
  next: 0,
})

export const pushWaveformLevel = ({
  history,
  level,
}: {
  history: IWaveformHistory
  level: number
}): IWaveformHistory => {
  const levels = Array.from(history.levels)
  levels[history.next] = clampLevel(level)
  return { size: history.size, levels, next: (history.next + 1) % history.size }
}

export const waveformOrderOf = (history: IWaveformHistory): readonly number[] => [
  ...history.levels.slice(history.next),
  ...history.levels.slice(0, history.next),
]

export const waveformReplayOf = ({
  levels,
  count,
}: {
  levels: readonly number[]
  count: number
}): readonly number[] => {
  const from = Math.max(0, levels.length - count)
  const window = levels.slice(from)
  if (window.length >= count) return window
  return [...new Array<number>(count - window.length).fill(0), ...window]
}

export const isSilentOf = (level: number): boolean => {
  'worklet'
  return level <= WAVEFORM_SILENCE_LEVEL
}
