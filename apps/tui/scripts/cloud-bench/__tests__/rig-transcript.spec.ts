import { describe, expect, test } from 'vitest'

import {
  assistantSaid,
  bodyOf,
  readEventsRetrying,
  transcriptLines,
  userSaidCount,
} from '../rig-transcript'

const said = (text: string) => ({ seq: 1, type: 'user-said', text })
const replied = (text: string) => ({
  seq: 2,
  type: 'assistant-said',
  parts: [
    { type: 'reasoning', text: 'thinking READY' },
    { type: 'text', text },
  ],
})
const nested = (body: unknown) => ({ seq: 3, body })

const lost = (): Error => {
  const error = new Error('The read-events request was never answered: socket closed.')
  error.name = 'RemoteRequestLost'
  return error
}

describe('bodyOf', () => {
  test('reads a body that sits flat on the event', () => {
    expect(bodyOf(said('hi'))).toEqual({ type: 'user-said', text: 'hi' })
  })

  test('reads a body nested under event.body', () => {
    expect(bodyOf(nested({ type: 'user-said', text: 'hi' }))).toEqual({
      type: 'user-said',
      text: 'hi',
    })
  })

  test('refuses shapes without a string type', () => {
    expect(bodyOf(null)).toBeNull()
    expect(bodyOf('user-said')).toBeNull()
    expect(bodyOf({ body: { text: 'hi' } })).toBeNull()
  })
})

describe('userSaidCount', () => {
  test('counts exact user messages in either shape and ignores assistant echoes', () => {
    const events = [
      said('Reply with the single word AWAKE.'),
      nested({ type: 'user-said', text: 'Reply with the single word AWAKE.\n' }),
      replied('Reply with the single word AWAKE.'),
      said('something else'),
    ]
    expect(userSaidCount({ events, text: 'Reply with the single word AWAKE.' })).toBe(2)
  })

  test('is zero on an empty transcript', () => {
    expect(userSaidCount({ events: [], text: 'x' })).toBe(0)
  })
})

describe('assistantSaid', () => {
  test('finds the word in a text part, case-insensitively, as a whole word', () => {
    expect(assistantSaid({ events: [replied('ready.')], word: 'READY' })).toBe(true)
    expect(assistantSaid({ events: [replied('ALREADYDONE')], word: 'READY' })).toBe(false)
  })

  test('ignores reasoning parts and user messages', () => {
    const events = [
      said('READY'),
      { type: 'assistant-said', parts: [{ type: 'reasoning', text: 'READY' }] },
    ]
    expect(assistantSaid({ events, word: 'READY' })).toBe(false)
  })

  test('only looks after afterIndex', () => {
    const events = [replied('DONE'), said('next'), replied('nope')]
    expect(assistantSaid({ events, word: 'DONE' })).toBe(true)
    expect(assistantSaid({ events, word: 'DONE', afterIndex: 0 })).toBe(false)
  })

  test('reads nested assistant bodies', () => {
    expect(
      assistantSaid({
        events: [nested({ type: 'assistant-said', parts: [{ type: 'text', text: 'AWAKE' }] })],
        word: 'AWAKE',
      }),
    ).toBe(true)
  })
})

describe('readEventsRetrying', () => {
  test('retries a RemoteRequestLost and returns the eventual read', async () => {
    let calls = 0
    const events = await readEventsRetrying({
      read: async () => {
        calls += 1
        if (calls < 3) throw lost()
        return [said('ok')]
      },
      pauseMs: 0,
    })
    expect(calls).toBe(3)
    expect(events).toHaveLength(1)
  })

  test('gives up after the attempt budget', async () => {
    let calls = 0
    const reading = readEventsRetrying({
      read: async () => {
        calls += 1
        throw lost()
      },
      attempts: 3,
      pauseMs: 0,
    })
    await expect(reading).rejects.toThrow('never answered')
    expect(calls).toBe(3)
  })

  test('does not retry other errors', async () => {
    let calls = 0
    const reading = readEventsRetrying({
      read: async () => {
        calls += 1
        throw new Error('refused')
      },
      pauseMs: 0,
    })
    await expect(reading).rejects.toThrow('refused')
    expect(calls).toBe(1)
  })
})

describe('transcriptLines', () => {
  test('renders one line per event with the visible text', () => {
    expect(transcriptLines([said('Reply READY'), replied('READY'), { seq: 9 }])).toBe(
      ['0: user-said: Reply READY', '1: assistant-said: READY', '2: (unrecognised event)'].join(
        '\n',
      ),
    )
  })

  test('says so when empty', () => {
    expect(transcriptLines([])).toBe('(no events)')
  })
})
