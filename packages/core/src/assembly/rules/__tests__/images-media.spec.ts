import { describe, expect, it } from 'bun:test'

import { ref } from '../../../media/__tests__/media-ref.spec'
import { toEventId } from '../../../events/ids'
import type { MediaPart } from '../../../message/parts'
import type { Assembled, AssembledMessage } from '../../assembled'
import { contextFor, log } from '../../__tests__/log-fixture'
import { MAX_IMAGE_BLOCKS, corruptImagesDropped, imagesInContext } from '../images'

const ctx = contextFor({ events: log([]) })

const media = (index: number, source?: string): MediaPart => ({
  type: 'media',
  media: { ...ref, hash: index.toString(16).padStart(64, '0'), width: 100 + index, height: 50 },
  ...(source === undefined ? {} : { source }),
})

const userWith = (index: number, part: MediaPart): AssembledMessage => ({
  message: { role: 'user', content: [{ type: 'text', text: `look ${index}` }, part] },
  origin: { eventId: toEventId(`event-${index}`), seq: index + 1 },
})

const assembledOf = (messages: readonly AssembledMessage[]): Assembled => ({
  system: [],
  messages,
})

const texts = (assembled: Assembled): string[] =>
  assembled.messages.flatMap((entry) =>
    entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
  )

describe('media parts under the image cap', () => {
  it('retires the oldest of twenty-one media parts as text, without decoding anything', () => {
    const input = assembledOf(
      Array.from({ length: MAX_IMAGE_BLOCKS + 1 }, (_, index) => userWith(index, media(index))),
    )

    const output = imagesInContext()(input, ctx)

    expect(texts(output)).toContain('[image dropped from context: image/png 100×50]')
    const kept = output.messages.filter((entry) =>
      entry.message.content.some((part) => part.type === 'media'),
    )
    expect(kept.length).toBe(MAX_IMAGE_BLOCKS)
    expect(output.messages[0]?.message.content[1]?.type).toBe('text')
  })

  it('names the source when the media part has one', () => {
    const input = assembledOf(
      [0, 1].map((index) => userWith(index, media(index, `/tmp/${index}.png`))),
    )

    expect(texts(imagesInContext({ limit: 1 })(input, ctx))).toContain(
      '[image dropped from context: /tmp/0.png · image/png 100×50]',
    )
  })

  it('counts media parts inside tool results', () => {
    const input = assembledOf([
      {
        message: {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c',
              toolName: 'read',
              output: { type: 'content', value: [media(0), media(1)] },
            },
          ],
        },
        origin: { eventId: toEventId('event-0'), seq: 1 },
      },
    ])

    const output = imagesInContext({ limit: 1 })(input, ctx)
    const value = output.messages[0]?.message.content[0]
    expect(value).toMatchObject({
      output: { value: [{ type: 'text' }, { type: 'media' }] },
    })
  })

  it('never inspects a media part when dropping corrupt images', () => {
    const input = assembledOf([userWith(0, media(0))])

    expect(corruptImagesDropped()(input, ctx)).toBe(input)
  })
})
