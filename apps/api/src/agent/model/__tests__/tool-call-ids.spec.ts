import { describe, expect, it } from 'bun:test'

import type { AssistantMessage, Message, ToolMessage } from '@dltech/atlas-core'

import { toModelMessages } from '../message-conversion'

describe('toModelMessages tool call ids', () => {
  const calledWith = (toolCallId: string): AssistantMessage => ({
    role: 'assistant',
    content: [{ type: 'tool-call', toolCallId, toolName: 'bash', input: { command: 'ls' } }],
  })

  const reportedWith = (toolCallId: string): ToolMessage => ({
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId, toolName: 'bash', output: { type: 'text', value: 'ok' } },
    ],
  })

  it('rewrites ids a stricter provider would reject, keeping the call and its result paired', () => {
    const sent = toModelMessages([calledWith('bash:16'), reportedWith('bash:16')])

    expect(sent).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'bash_16', toolName: 'bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'bash_16',
            toolName: 'bash',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ])
  })

  it('leaves already-safe ids untouched', () => {
    const messages: Message[] = [calledWith('read_68'), reportedWith('read_68')]

    expect(toModelMessages(messages)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'read_68', toolName: 'bash', input: { command: 'ls' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'read_68',
            toolName: 'bash',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ])
  })

  it('never collides a rewritten id with one the thread already carries', () => {
    const sent = toModelMessages([
      calledWith('bash_16'),
      calledWith('bash:16'),
      reportedWith('bash:16'),
    ])

    const ids = sent.flatMap((message) =>
      typeof message.content === 'string'
        ? []
        : message.content.map((part) => ('toolCallId' in part ? part.toolCallId : '')),
    )
    expect(ids).toEqual(['bash_16', 'bash_16_', 'bash_16_'])
  })
})
