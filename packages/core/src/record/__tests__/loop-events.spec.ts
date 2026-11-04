import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor } from '../../events/body'
import { toCallId } from '../../events/ids'
import { assemble } from '../../assembly/assemble'
import { contextFor } from '../../assembly/__tests__/log-fixture'
import { exchangeFaults } from '../../assembly/exchange-shape'
import { defaultRules } from '../../assembly/pipeline'
import { EMPTY_PROMPT } from '../../assembly/rules/system-prompt'
import { chainEvents } from '../chain-events'
import type { V2Body } from '../event'
import { visibleLoopEvents } from '../loop-events'
import { NOW, runId, threadId } from './support'

const call = toCallId('call-1')

const record = (bodies: readonly V2Body[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const promptOf = (bodies: readonly V2Body[]) =>
  assemble({
    rules: defaultRules({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
    ctx: contextFor({ events: visibleLoopEvents(record(bodies)) }),
  }).assembled

const textOf = (entry: { message: { content: readonly unknown[] } } | undefined): string =>
  JSON.stringify(entry?.message.content ?? [])

const summarised = (fromSeq: number, throughSeq: number): V2Body => ({
  type: 'history-summarised',
  fromSeq,
  throughSeq,
  anchor: ECompactionAnchor.Prefix,
  summary: 'the opening exchange',
})

describe('visibleLoopEvents', () => {
  it('draws a summary over the opening turn as the first user message', () => {
    const prompt = promptOf([
      { type: 'user-said', text: 'build the parser' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      { type: 'user-said', text: 'now the lexer' },
      summarised(1, 2),
    ])

    expect(prompt.messages[0]?.message.role).toBe('user')
    expect(textOf(prompt.messages[0])).toContain('the opening exchange')
    expect(textOf(prompt.messages[1])).toContain('now the lexer')
    expect(exchangeFaults(prompt)).toEqual([])
  })

  it('puts the summary where its range was, not where the summary was appended', () => {
    const prompt = promptOf([
      { type: 'user-said', text: 'first' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'one' }] },
      { type: 'user-said', text: 'second' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'two' }] },
      { type: 'user-said', text: 'third' },
      summarised(1, 2),
    ])

    const texts = prompt.messages.map(textOf)
    expect(texts.findIndex((text) => text.includes('the opening exchange'))).toBeLessThan(
      texts.findIndex((text) => text.includes('second')),
    )
  })

  it('drops a result whose call the summary hid, and keeps one whose call it did not', () => {
    const hidCall = promptOf([
      { type: 'user-said', text: 'go' },
      { type: 'tool-called', callId: call, name: 'read', input: {}, ordinal: 0 },
      { type: 'tool-result', callId: call, name: 'read', output: 'a', modelText: 'a' },
      { type: 'user-said', text: 'next' },
      summarised(1, 2),
    ])
    const hidResult = promptOf([
      { type: 'user-said', text: 'go' },
      { type: 'tool-called', callId: call, name: 'read', input: {}, ordinal: 0 },
      { type: 'tool-result', callId: call, name: 'read', output: 'a', modelText: 'a' },
      { type: 'user-said', text: 'next' },
      summarised(1, 1),
    ])

    expect(exchangeFaults(hidCall)).toEqual([])
    expect(hidCall.messages.some((entry) => entry.message.role === 'tool')).toBe(false)
    expect(exchangeFaults(hidResult)).toEqual([])
    expect(hidResult.messages.map((entry) => entry.message.role).slice(0, 3)).toEqual([
      'user',
      'assistant',
      'tool',
    ])
  })

  it('brings the summarised rows back when a rewind lands before the summary', () => {
    const prompt = promptOf([
      { type: 'user-said', text: 'build the parser' },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] },
      { type: 'user-said', text: 'now the lexer' },
      summarised(1, 2),
      { type: 'history-rewound', toSeq: 3 },
    ])

    const texts = prompt.messages.map(textOf)
    expect(texts.some((text) => text.includes('build the parser'))).toBe(true)
    expect(texts.some((text) => text.includes('the opening exchange'))).toBe(false)
  })
})
