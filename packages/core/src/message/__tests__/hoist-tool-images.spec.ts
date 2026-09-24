import { describe, expect, it } from 'bun:test'

import { hoistToolResultImages } from '../hoist-tool-images'
import type { Message, ToolMessage } from '../message'
import type { ImagePart, ToolResultPart } from '../parts'

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const image = (source?: string): ImagePart => ({
  type: 'image',
  data: PIXEL,
  mediaType: 'image/png',
  ...(source === undefined ? {} : { source }),
})

const toolResult = (part: Pick<ToolResultPart, 'output'>): ToolResultPart => ({
  type: 'tool-result',
  toolCallId: 'read_1',
  toolName: 'read',
  output: part.output,
})

const toolMessage = (parts: readonly ToolResultPart[]): ToolMessage => ({ role: 'tool', content: parts })

describe('hoistToolResultImages', () => {
  it('leaves a conversation without tool-result images untouched', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      toolMessage([toolResult({ output: { type: 'text', value: '2 lines' } })]),
    ]

    expect(hoistToolResultImages({ messages })).toEqual(messages)
  })

  it('moves an image out of the tool result into a user message that names its source', () => {
    const messages: Message[] = [
      toolMessage([
        toolResult({
          output: {
            type: 'content',
            value: [{ type: 'text', text: '/tmp/shot.png — image/png, 2704×600.' }, image('/tmp/shot.png')],
          },
        }),
      ]),
    ]

    expect(hoistToolResultImages({ messages })).toEqual([
      toolMessage([
        toolResult({
          output: { type: 'content', value: [{ type: 'text', text: '/tmp/shot.png — image/png, 2704×600.' }] },
        }),
      ]),
      {
        role: 'user',
        content: [image('/tmp/shot.png'), { type: 'text', text: 'Images from the tool result above: /tmp/shot.png.' }],
      },
    ])
  })

  it('leaves a placeholder in the tool result when the image was its only content', () => {
    const messages: Message[] = [toolMessage([toolResult({ output: { type: 'content', value: [image()] } })])]

    const hoisted = hoistToolResultImages({ messages })
    const tool = hoisted[0]
    if (tool?.role !== 'tool') throw new Error('expected the tool message first')
    const part = tool.content[0]
    if (part?.output.type !== 'content') throw new Error('expected content output')

    expect(part.output.value).toEqual([{ type: 'text', text: 'the image is attached in the next message' }])
    expect(hoisted[1]).toEqual({
      role: 'user',
      content: [image(), { type: 'text', text: 'Images from the tool result above.' }],
    })
  })

  it('gathers images from several results of one tool message into a single user message', () => {
    const second: ToolResultPart = { ...toolResult({ output: { type: 'content', value: [image('/tmp/b.png')] } }), toolCallId: 'read_2' }
    const messages: Message[] = [
      toolMessage([
        toolResult({ output: { type: 'content', value: [{ type: 'text', text: 'a' }, image('/tmp/a.png')] } }),
        second,
      ]),
    ]

    const hoisted = hoistToolResultImages({ messages })

    expect(hoisted).toHaveLength(2)
    const anchor = hoisted[1]
    if (anchor?.role !== 'user') throw new Error('expected one hoisted user message')
    expect(anchor.content.filter((part) => part.type === 'image')).toHaveLength(2)
    expect(anchor.content.at(-1)).toEqual({
      type: 'text',
      text: 'Images from the tool result above: /tmp/a.png, /tmp/b.png.',
    })
  })

  it('leaves pasted user images and non-content outputs alone', () => {
    const messages: Message[] = [
      { role: 'user', content: [image(), { type: 'text', text: 'what is this' }] },
      toolMessage([toolResult({ output: { type: 'json', value: { lines: 3 } } })]),
    ]

    expect(hoistToolResultImages({ messages })).toEqual(messages)
  })
})
