import { describe, expect, it } from 'bun:test'
import type { ModelMessage } from 'ai'

import type { AssistantMessage, Message, ToolMessage, UserMessage } from '@dltech/atlas-core'

import {
  fromModelMessage,
  fromModelMessages,
  toModelMessage,
  toModelMessages,
} from '../message-conversion'

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const userSaid: UserMessage = {
  role: 'user',
  content: [
    {
      type: 'text',
      text: 'what changed?',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
  ],
}

const assistantSaid: AssistantMessage = {
  role: 'assistant',
  content: [
    {
      type: 'reasoning',
      text: 'checking the diff',
      providerOptions: { anthropic: { signature: 'sig-abc' } },
    },
    { type: 'text', text: 'two files' },
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'a.ts' } },
  ],
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
}

const toolReported: ToolMessage = {
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'read_file',
      output: { type: 'json', value: { lines: 12 } },
    },
  ],
}

describe('toModelMessage', () => {
  it('carries a user text part and its provider options through untouched', () => {
    expect(toModelMessage(userSaid)).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'what changed?',
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
      ],
    })
  })

  it('carries a reasoning signature and a tool call through untouched', () => {
    expect(toModelMessage(assistantSaid)).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'checking the diff',
          providerOptions: { anthropic: { signature: 'sig-abc' } },
        },
        { type: 'text', text: 'two files' },
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'a.ts' } },
      ],
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
  })

  it('omits the provider options key entirely when there are none', () => {
    const converted = toModelMessage({ role: 'user', content: [{ type: 'text', text: 'hi' }] })
    const content = converted.content
    if (typeof content === 'string') throw new Error('expected the converted content to be parts')

    expect(Object.keys(converted)).toEqual(['role', 'content'])
    expect(Object.keys(content[0] ?? {})).toEqual(['type', 'text'])
  })

  it('carries a tool result output through untouched', () => {
    expect(toModelMessage(toolReported)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read_file',
          output: { type: 'json', value: { lines: 12 } },
        },
      ],
    })
  })
})

describe('fromModelMessage', () => {
  it('round-trips every role back to the same value', () => {
    const messages: Message[] = [userSaid, assistantSaid, toolReported]

    expect(fromModelMessages(toModelMessages(messages))).toEqual(messages)
  })

  it('lifts a bare string user message into a single text part', () => {
    expect(fromModelMessage({ role: 'user', content: 'hello' })).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('lifts a bare string assistant message into a single text part', () => {
    expect(fromModelMessage({ role: 'assistant', content: 'hello' })).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('refuses a system message, which belongs in instructions', () => {
    expect(() => fromModelMessage({ role: 'system', content: 'be brief' })).toThrow(/system/i)
  })

  it('accepts a url image part as url bytes', () => {
    const withImage: ModelMessage = {
      role: 'user',
      content: [
        { type: 'image', image: new URL('https://example.test/a.png'), mediaType: 'image/png' },
      ],
    }

    expect(fromModelMessage(withImage)).toEqual({
      role: 'user',
      content: [
        {
          type: 'image',
          bytes: { kind: 'url', url: 'https://example.test/a.png' },
          mediaType: 'image/png',
        },
      ],
    })
  })

  it('accepts a url string image part as url bytes', () => {
    const withImage: ModelMessage = {
      role: 'user',
      content: [{ type: 'image', image: 'https://example.test/a.png' }],
    }

    expect(fromModelMessage(withImage)).toMatchObject({
      content: [{ type: 'image', bytes: { kind: 'url', url: 'https://example.test/a.png' } }],
    })
  })

  it('still accepts a data uri image part as inline bytes', () => {
    const withImage: ModelMessage = {
      role: 'user',
      content: [{ type: 'image', image: `data:image/png;base64,${PIXEL}` }],
    }

    expect(fromModelMessage(withImage)).toEqual({
      role: 'user',
      content: [{ type: 'image', bytes: { kind: 'inline', data: PIXEL }, mediaType: 'image/png' }],
    })
  })

  it('sends a url image part out as a URL image and reads it back unchanged', () => {
    const core = {
      role: 'user' as const,
      content: [
        {
          type: 'image' as const,
          bytes: { kind: 'url' as const, url: 'https://example.test/a.png' },
          mediaType: 'image/png',
        },
      ],
    }

    const sent = toModelMessage(core)

    expect(sent).toEqual({
      role: 'user',
      content: [
        { type: 'image', image: new URL('https://example.test/a.png'), mediaType: 'image/png' },
      ],
    })
    expect(fromModelMessage(sent)).toEqual(core)
  })

  it('sends an inline image part out as data and reads it back unchanged', () => {
    const core = {
      role: 'user' as const,
      content: [
        {
          type: 'image' as const,
          bytes: { kind: 'inline' as const, data: PIXEL },
          mediaType: 'image/png',
        },
      ],
    }

    expect(fromModelMessage(toModelMessage(core))).toEqual(core)
  })

  it('sends a tool result url image as a url file and reads it back as a url image', () => {
    const core = {
      role: 'tool' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: 'call-1',
          toolName: 'read',
          output: {
            type: 'content' as const,
            value: [
              {
                type: 'image' as const,
                bytes: { kind: 'url' as const, url: 'https://example.test/a.png' },
                mediaType: 'image/png',
              },
            ],
          },
        },
      ],
    }

    expect(fromModelMessage(toModelMessage(core))).toEqual(core)
  })

  it('carries an inline image back into a core user message', () => {
    const withImage: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'what is broken here?' },
        { type: 'image', image: PIXEL, mediaType: 'image/png' },
      ],
    }

    expect(fromModelMessage(withImage)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is broken here?' },
        { type: 'image', bytes: { kind: 'inline', data: PIXEL }, mediaType: 'image/png' },
      ],
    })
  })

  it('carries a mixed tool result back into a core tool message', () => {
    const withContentOutput: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read_file',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'Read image file [image/png] 1x1' },
              { type: 'file', data: { type: 'data', data: PIXEL }, mediaType: 'image/png' },
            ],
          },
        },
      ],
    }

    expect(fromModelMessage(withContentOutput)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read_file',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'Read image file [image/png] 1x1' },
              { type: 'image', bytes: { kind: 'inline', data: PIXEL }, mediaType: 'image/png' },
            ],
          },
        },
      ],
    })
  })

  it('sends an image part out as a file part, the SDK spelling since image parts were deprecated', () => {
    const sent = toModelMessage({
      role: 'user',
      content: [{ type: 'image', bytes: { kind: 'inline', data: PIXEL }, mediaType: 'image/png' }],
    })

    expect(sent).toEqual({
      role: 'user',
      content: [{ type: 'file', data: { type: 'data', data: PIXEL }, mediaType: 'image/png' }],
    })
  })

  it('carries an inline file part back into a core user message', () => {
    const withFile: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'what is broken here?' },
        { type: 'file', data: { type: 'data', data: PIXEL }, mediaType: 'image/png' },
      ],
    }

    expect(fromModelMessage(withFile)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is broken here?' },
        { type: 'image', bytes: { kind: 'inline', data: PIXEL }, mediaType: 'image/png' },
      ],
    })
  })

  it('carries an inline PDF file part back into a core file part', () => {
    const withPdf: ModelMessage = {
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: PIXEL },
          mediaType: 'application/pdf',
          filename: 'spec.pdf',
        },
      ],
    }

    expect(fromModelMessage(withPdf)).toEqual({
      role: 'user',
      content: [{ type: 'file', data: PIXEL, mediaType: 'application/pdf', filename: 'spec.pdf' }],
    })
  })

  it('sends a core file part out as an SDK file part with its filename', () => {
    const sent = toModelMessage({
      role: 'user',
      content: [
        {
          type: 'file',
          data: PIXEL,
          mediaType: 'application/pdf',
          filename: 'spec.pdf',
          source: '/tmp/spec.pdf',
        },
      ],
    })

    expect(sent).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: PIXEL },
          mediaType: 'application/pdf',
          filename: 'spec.pdf',
        },
      ],
    })
  })

  it('carries a non-image tool result file back into a core file part', () => {
    const withFileOutput: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'spec.pdf — application/pdf, 64 KB.' },
              {
                type: 'file',
                data: { type: 'data', data: PIXEL },
                mediaType: 'application/pdf',
                filename: 'spec.pdf',
              },
            ],
          },
        },
      ],
    }

    expect(fromModelMessage(withFileOutput)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'spec.pdf — application/pdf, 64 KB.' },
              { type: 'file', data: PIXEL, mediaType: 'application/pdf', filename: 'spec.pdf' },
            ],
          },
        },
      ],
    })
  })

  it('sends a tool result image as an inline file, which is the SDK spelling', () => {
    const sent = toModelMessage({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: {
            type: 'content',
            value: [
              { type: 'image', bytes: { kind: 'inline', data: PIXEL }, mediaType: 'image/png' },
            ],
          },
        },
      ],
    })

    expect(sent).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: {
            type: 'content',
            value: [{ type: 'file', data: { type: 'data', data: PIXEL }, mediaType: 'image/png' }],
          },
        },
      ],
    })
  })
})

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

describe('toModelMessage with a media part', () => {
  const media = {
    hash: 'a'.repeat(64),
    mediaType: 'image/png',
    size: 10,
    width: 640,
    height: 480,
  } as const

  it('names a user media part by its source when the source is a path', () => {
    const message: UserMessage = {
      role: 'user',
      content: [{ type: 'media', media, source: '/tmp/shot.png' }],
    }

    expect(toModelMessage(message)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '[image /tmp/shot.png · 640×480]' }],
    })
  })

  it('falls back to the hash when the media part has no source, in a tool result too', () => {
    const message: ToolMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: { type: 'content', value: [{ type: 'media', media }] },
        },
      ],
    }

    expect(toModelMessage(message)).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'read',
          output: {
            type: 'content',
            value: [{ type: 'text', text: `[image unavailable: ${'a'.repeat(64)}]` }],
          },
        },
      ],
    })
  })
})
