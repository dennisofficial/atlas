import { describe, expect, it } from 'bun:test'

import { EDictationEvent, type TDictationEvent } from '../dictation-engine'
import type { IDictationStep } from '../dictation-script'
import { FakeDictationEngine, fakeStepsOf, fakeTranscriptStepsOf } from '../fake-dictation-engine'

const timeline = [
  { word: 'a', startMs: 10 },
  { word: 'b', startMs: 20 },
  { word: 'c', startMs: 30 },
  { word: 'd', startMs: 40 },
  { word: 'e', startMs: 50 },
]

const spokenOfSteps = (steps: readonly IDictationStep[]): readonly TDictationEvent[] =>
  steps.map((step) => step.event).filter((event) => event.type !== EDictationEvent.Level)

const spokenOfEvents = (events: readonly TDictationEvent[]): readonly TDictationEvent[] =>
  events.filter((event) => event.type !== EDictationEvent.Level)

describe('fakeTranscriptStepsOf', () => {
  it('streams each word as interim until a group of them completes', () => {
    expect(spokenOfSteps(fakeTranscriptStepsOf({ timeline, commitEvery: 2 }))).toEqual([
      { type: EDictationEvent.Partial, text: 'a' },
      { type: EDictationEvent.Final, text: 'a b' },
      { type: EDictationEvent.Partial, text: 'a b c' },
      { type: EDictationEvent.Final, text: 'a b c d' },
      { type: EDictationEvent.Final, text: 'a b c d e' },
    ])
  })

  it('dates every word at the moment it arrives', () => {
    const steps = fakeTranscriptStepsOf({ timeline, commitEvery: 2 })
    expect(steps.map((step) => step.atMs)).toEqual([10, 20, 30, 40, 50])
  })

  it('takes no level steps, so a live microphone owns the waveform', () => {
    const steps = fakeTranscriptStepsOf({ timeline })
    expect(steps.every((step) => step.event.type !== EDictationEvent.Level)).toBe(true)
  })
})

describe('fakeStepsOf', () => {
  it('adds a level for every step of the clock and ends after the tail', () => {
    const steps = fakeStepsOf({ timeline, commitEvery: 2, levelStepMs: 20 })
    const levels = steps.filter((step) => step.event.type === EDictationEvent.Level)
    expect(levels.length).toBeGreaterThan(40)
    for (const step of levels) {
      const level = step.event.type === EDictationEvent.Level ? step.event.level : -1
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
    expect(steps.at(-1)?.event.type).toBe(EDictationEvent.Ended)
    expect(steps.at(-1)?.atMs).toBe(950)
  })

  it('keeps the steps in time order', () => {
    const times = fakeStepsOf({ timeline, commitEvery: 2, levelStepMs: 5 }).map((step) => step.atMs)
    expect(times).toEqual([...times].sort((left, right) => left - right))
  })
})

describe('FakeDictationEngine', () => {
  it('speaks the whole script, then ends on its own', async () => {
    const events: TDictationEvent[] = []
    const engine = new FakeDictationEngine({
      timeline: [
        { word: 'one', startMs: 10 },
        { word: 'two', startMs: 20 },
      ],
      commitEvery: 2,
      levelStepMs: 100,
    })
    await new Promise<void>((resolve) => {
      void engine.start({
        onEvent: (event) => {
          events.push(event)
          if (event.type === EDictationEvent.Ended) resolve()
        },
      })
    })
    const spoken = spokenOfEvents(events)
    expect(spoken.at(-1)).toEqual({ type: EDictationEvent.Ended })
    expect(spoken.at(-2)).toEqual({ type: EDictationEvent.Final, text: 'one two' })
    expect(events[0]).toEqual({ type: EDictationEvent.Level, level: 0 })
  })

  it('stops early with the words heard so far', async () => {
    const events: TDictationEvent[] = []
    const engine = new FakeDictationEngine({
      timeline: [
        { word: 'one', startMs: 0 },
        { word: 'two', startMs: 400 },
      ],
      commitEvery: 2,
      levelStepMs: 100,
    })
    const session = await engine.start({ onEvent: (event) => events.push(event) })
    await session.stop()
    expect(events.at(-1)).toEqual({ type: EDictationEvent.Ended })
    expect(events.at(-2)).toEqual({ type: EDictationEvent.Final, text: 'one' })
  })
})
