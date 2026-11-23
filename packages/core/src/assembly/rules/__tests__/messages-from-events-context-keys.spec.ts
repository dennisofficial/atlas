import { describe, expect, it } from 'bun:test'

import type { EventDraft } from '../../../events/body'
import { toCallId } from '../../../events/ids'
import type { Assembled } from '../../assembled'
import { contextFor, log } from '../../__tests__/log-fixture'
import { messagesFromEvents } from '../messages-from-events'

const empty: Assembled = { system: [], messages: [] }

const callA = {
  type: 'tool-called' as const,
  callId: toCallId('call-a'),
  name: 'write',
  ordinal: 1,
}

const resultA = {
  type: 'tool-result' as const,
  callId: toCallId('call-a'),
  name: 'write',
  output: {},
}

const callB = {
  type: 'tool-called' as const,
  callId: toCallId('call-b'),
  name: 'write',
  ordinal: 2,
}

const resultB = {
  type: 'tool-result' as const,
  callId: toCallId('call-b'),
  name: 'write',
  output: {},
}

const findingOn = (args: { call: string; content: string; slot?: string }): EventDraft => ({
  type: 'context-loaded',
  slot: args.slot ?? 'review',
  key: args.call,
  content: args.content,
})

const steps = (count: number): EventDraft[] =>
  Array.from({ length: count }, (_unused, index) => [
    { type: 'assistant-said' as const, parts: [{ type: 'text' as const, text: `step ${index}` }] },
    { type: 'user-said' as const, text: `carry on ${index}` },
  ]).flat()

const projected = (drafts: readonly EventDraft[]): string =>
  messagesFromEvents()(empty, contextFor({ events: log(drafts) }))
    .messages.map((entry) => JSON.stringify(entry.message.content))
    .join('\n')

describe('context keyed to the call it belongs to', () => {
  it('keeps a finding that the log recorded many steps ago', () => {
    const text = projected([
      callA,
      resultA,
      findingOn({ call: 'call-a', content: 'finding A' }),
      ...steps(4),
    ])

    expect(text).toContain('finding A')
  })

  it('keeps a finding for each call rather than letting one replace the other', () => {
    const text = projected([
      callA,
      resultA,
      findingOn({ call: 'call-a', content: 'finding A' }),
      ...steps(3),
      callB,
      resultB,
      findingOn({ call: 'call-b', content: 'finding B' }),
      ...steps(3),
    ])

    expect(text).toContain('finding A')
    expect(text).toContain('finding B')
  })

  it('projects only the later context when two share a slot and a key', () => {
    const text = projected([
      findingOn({ call: 'call-a', content: 'first finding' }),
      ...steps(3),
      findingOn({ call: 'call-a', content: 'second finding' }),
    ])

    expect(text).toContain('second finding')
    expect(text).not.toContain('first finding')
  })
})
