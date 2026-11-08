import { describe, expect, it } from 'bun:test'

import { type Assembled, type V2Event } from '@dltech/atlas-core'

import { withRunningRoster } from '../roster-message'

const event = (n: number, body: Record<string, unknown>): V2Event =>
  ({
    ...body,
    id: `e${n}`,
    seq: n,
    at: '2026-11-08T10:00:00.000Z',
    threadId: 't1',
  }) as unknown as V2Event

const started = (n: number, shellId: string) =>
  event(n, { type: 'background-shell-started', shellId, command: `run ${shellId}` })

const assembled: Assembled = { system: [], messages: [] }

const lastText = (result: Assembled): string => {
  const content = result.messages.at(-1)?.message.content
  const part = Array.isArray(content) ? content[0] : undefined
  return part !== undefined && part.type === 'text' ? part.text : ''
}

describe('withRunningRoster', () => {
  it('returns the same object when nothing is running', () => {
    const ended = event(2, {
      type: 'background-shell-ended',
      shellId: 'shell-a',
      command: 'x',
      status: 'exited',
      output: '',
      droppedCharacters: 0,
      remainingCharacters: 0,
    })
    expect(withRunningRoster({ assembled, events: [] })).toBe(assembled)
    expect(withRunningRoster({ assembled, events: [started(1, 'shell-a'), ended] })).toBe(assembled)
  })

  it('appends a volatile reminder naming a running shell, anchored on the last event', () => {
    const result = withRunningRoster({ assembled, events: [started(1, 'shell-a')] })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      volatile: true,
      origin: { eventId: 'e1', seq: 1 },
    })
    expect(lastText(result)).toContain('shell-a')
    expect(lastText(result)).toContain('These background shells are still running:')
  })

  it('names every running shell', () => {
    const result = withRunningRoster({
      assembled,
      events: [started(1, 'shell-a'), started(2, 'shell-b')],
    })
    expect(lastText(result)).toContain('shell-a')
    expect(lastText(result)).toContain('shell-b')
    expect(String(result.messages[0]?.origin.eventId)).toBe('e2')
    expect(result.messages[0]?.origin.seq).toBe(2)
  })
})
