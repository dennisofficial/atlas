import { describe, expect, it } from 'bun:test'

import { toCallId } from '../../events/ids'
import { assemble } from '../assemble'
import { messagesFromEvents } from '../rules/messages-from-events'
import { contextFor, log } from './log-fixture'

const callToolExchange = (): ReturnType<typeof log> => {
  const callId = toCallId('call-1')
  return log([
    { type: 'user-said', text: 'find my last meeting' },
    {
      type: 'tool-called',
      callId,
      name: 'call_tool',
      input: { tool: 'mcp__wispr-flow__search_meetings', args: { query: 'weekly' } },
      ordinal: 0,
    },
    {
      type: 'tool-result',
      callId,
      name: 'call_tool',
      output: { server: 'wispr-flow', tool: 'search_meetings' },
      modelText: 'one meeting',
    },
  ])
}

describe('a call_tool exchange in the assembled history', () => {
  it('replays the call the model made, with its own input', () => {
    const { assembled } = assemble({
      rules: [messagesFromEvents()],
      ctx: contextFor({ events: callToolExchange() }),
    })

    expect(assembled.messages[1]?.message.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'call_tool',
        input: { tool: 'mcp__wispr-flow__search_meetings', args: { query: 'weekly' } },
      },
    ])
  })

  it('pairs the result with that call under the same name', () => {
    const { assembled } = assemble({
      rules: [messagesFromEvents()],
      ctx: contextFor({ events: callToolExchange() }),
    })

    const answer = assembled.messages[2]?.message
    expect(answer?.role).toBe('tool')
    expect(answer?.content).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'call_tool',
        output: { type: 'text', value: 'one meeting' },
      },
    ])
  })
})
