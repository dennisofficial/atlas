import { describe, expect, it } from 'bun:test'

import { EDictationEvent, type TDictationEvent } from '../dictation-engine'
import { startScriptOf } from '../dictation-script'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const collect = () => {
  const events: TDictationEvent[] = []
  return { events, onEvent: (event: TDictationEvent) => events.push(event) }
}

const typesOf = (events: readonly TDictationEvent[]) => events.map((event) => event.type)

describe('startScriptOf', () => {
  it('replays the steps in order and then stops on its own', async () => {
    const { events, onEvent } = collect()
    startScriptOf({
      steps: [
        { atMs: 0, event: { type: EDictationEvent.Level, level: 0.2 } },
        { atMs: 2, event: { type: EDictationEvent.Partial, text: 'Open a' } },
        { atMs: 4, event: { type: EDictationEvent.Final, text: 'Open a PR' } },
        { atMs: 6, event: { type: EDictationEvent.Ended } },
      ],
      onEvent,
    })
    await wait(40)
    expect(typesOf(events)).toEqual([
      EDictationEvent.Level,
      EDictationEvent.Partial,
      EDictationEvent.Final,
      EDictationEvent.Ended,
    ])
  })

  it('commits the interim words and ends when stopped between words', async () => {
    const { events, onEvent } = collect()
    const session = startScriptOf({
      steps: [
        { atMs: 0, event: { type: EDictationEvent.Partial, text: 'Open a' } },
        { atMs: 500, event: { type: EDictationEvent.Partial, text: 'Open a PR' } },
      ],
      onEvent,
    })
    await session.stop()
    expect(events).toEqual([
      { type: EDictationEvent.Partial, text: 'Open a' },
      { type: EDictationEvent.Final, text: 'Open a' },
      { type: EDictationEvent.Ended },
    ])
    await wait(10)
    expect(events).toHaveLength(3)
  })

  it('emits nothing more once cancelled', async () => {
    const { events, onEvent } = collect()
    const session = startScriptOf({
      steps: [
        { atMs: 0, event: { type: EDictationEvent.Partial, text: 'Open' } },
        { atMs: 400, event: { type: EDictationEvent.Ended } },
      ],
      onEvent,
    })
    session.cancel()
    await wait(20)
    expect(events).toEqual([{ type: EDictationEvent.Partial, text: 'Open' }])
  })

  it('ends with no final when nothing was heard yet', async () => {
    const { events, onEvent } = collect()
    const session = startScriptOf({
      steps: [{ atMs: 400, event: { type: EDictationEvent.Partial, text: 'Open' } }],
      onEvent,
    })
    await session.stop()
    expect(typesOf(events)).toEqual([EDictationEvent.Ended])
  })
})
