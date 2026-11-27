import { describe, expect, it } from 'bun:test'

import {
  COMMIT_EVERY,
  DICTATION_SCRIPT_WORDS,
  speechLevelOf,
  transcriptAtOf,
  voiceDurationOf,
  voiceTimelineOf,
  WORD_MS,
} from '../fake-voice'

const timeline = voiceTimelineOf()

describe('voiceTimelineOf', () => {
  it('gives every scripted word a later start', () => {
    const starts = timeline.map((entry) => entry.startMs)
    const sorted = [...starts].sort((left, right) => left - right)
    expect(starts).toEqual(sorted)
    expect(starts[0]).toBe(220)
  })

  it('spells the whole script', () => {
    expect(timeline.map((entry) => entry.word)).toEqual([...DICTATION_SCRIPT_WORDS])
    expect(timeline.at(-1)?.startMs).toBeGreaterThan(WORD_MS * (timeline.length - 1))
  })

  it('runs for the length of the script plus a tail', () => {
    expect(voiceDurationOf(timeline)).toBeGreaterThan(timeline.at(-1)?.startMs ?? 0)
    expect(voiceDurationOf([])).toBe(0)
  })
})

describe('transcriptAtOf', () => {
  it('starts empty', () => {
    expect(transcriptAtOf({ timeline, elapsedMs: 0 })).toEqual({ committed: '', interim: '' })
  })

  it('shows the arrived words as interim until a group of them completes', () => {
    const elapsedMs = timeline[1]?.startMs ?? 0
    expect(transcriptAtOf({ timeline, elapsedMs })).toEqual({
      committed: '',
      interim: `${DICTATION_SCRIPT_WORDS[0]} ${DICTATION_SCRIPT_WORDS[1]}`,
    })
  })

  it('commits the group once the last word of it arrives', () => {
    const elapsedMs = timeline[COMMIT_EVERY - 1]?.startMs ?? 0
    expect(transcriptAtOf({ timeline, elapsedMs })).toEqual({
      committed: DICTATION_SCRIPT_WORDS.slice(0, COMMIT_EVERY).join(' '),
      interim: '',
    })
  })

  it('streams the next group as interim over the committed text', () => {
    const elapsedMs = timeline[COMMIT_EVERY + 1]?.startMs ?? 0
    const transcript = transcriptAtOf({ timeline, elapsedMs })
    expect(transcript.committed).toBe(DICTATION_SCRIPT_WORDS.slice(0, COMMIT_EVERY).join(' '))
    expect(transcript.interim).toBe(
      DICTATION_SCRIPT_WORDS.slice(COMMIT_EVERY, COMMIT_EVERY + 2).join(' '),
    )
  })

  it('ends with the whole script committed and nothing interim', () => {
    const transcript = transcriptAtOf({ timeline, elapsedMs: voiceDurationOf(timeline) })
    expect(transcript.interim).toBe('')
    expect(transcript.committed).toBe(DICTATION_SCRIPT_WORDS.join(' '))
  })
})

describe('speechLevelOf', () => {
  it('rests at silence through a phrase pause', () => {
    expect(speechLevelOf({ elapsedMs: 2800 })).toBe(0)
  })

  it('peaks inside a syllable', () => {
    expect(speechLevelOf({ elapsedMs: 84 })).toBeGreaterThan(0.4)
  })

  it('stays inside zero and one over the whole phrase', () => {
    for (let elapsedMs = 0; elapsedMs < 8000; elapsedMs += 7) {
      const level = speechLevelOf({ elapsedMs })
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
  })

  it('never reads a negative time', () => {
    expect(speechLevelOf({ elapsedMs: -120 })).toBe(0)
  })
})
