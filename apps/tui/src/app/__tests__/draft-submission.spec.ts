import { describe, expect, test } from 'bun:test'

import type { EImageDelivery } from '@dltech/atlas-core'

import type { ClipboardImage } from '../../ui/clipboard-image'
import type { LiveToken } from '../../ui/composer-tokens'
import { draftSubmissionOf } from '../draft-submission'

const imageOf = (path: string): ClipboardImage => ({
  path,
  mediaType: 'image/png',
  byteLength: 10,
  delivery: 'inline' as EImageDelivery,
})

const pastedToken = (args: { start: number; end: number; content: string }): LiveToken => ({
  id: args.start,
  start: args.start,
  end: args.end,
  ordinal: 0,
  slot: { kind: 'pasted', label: '[Pasted text #1]', content: args.content },
})

const imageToken = (args: {
  start: number
  end: number
  ordinal: number
  path: string
}): LiveToken => ({
  id: args.start,
  start: args.start,
  end: args.end,
  ordinal: args.ordinal,
  slot: { kind: 'image', ordinal: args.ordinal, settled: true, image: imageOf(args.path) },
})

describe('draftSubmissionOf', () => {
  test('splices a pasted block back into the text', () => {
    const text = 'before [Pasted text #1] after'
    const start = text.indexOf('[Pasted')
    const submission = draftSubmissionOf({
      text,
      tokens: [
        pastedToken({ start, end: start + '[Pasted text #1]'.length, content: 'the block' }),
      ],
    })

    expect(submission.text).toBe('before the block after')
    expect(submission.images).toEqual([])
  })

  test('a settled image leaves the text and joins the images', () => {
    const text = 'look [Image #1]'
    const start = text.indexOf('[Image')
    const submission = draftSubmissionOf({
      text,
      tokens: [
        imageToken({ start, end: start + '[Image #1]'.length, ordinal: 1, path: '/pastes/a.png' }),
      ],
    })

    expect(submission.text).toBe('look')
    expect(submission.images).toEqual([{ ...imageOf('/pastes/a.png'), ordinal: 1 }])
  })

  test('two tokens splice right to left so earlier offsets hold', () => {
    const text = '[Pasted text #1] and [Pasted text #2]'
    const second = text.indexOf('[Pasted text #2]')
    const submission = draftSubmissionOf({
      text,
      tokens: [
        pastedToken({ start: 0, end: '[Pasted text #1]'.length, content: 'first' }),
        pastedToken({
          start: second,
          end: second + '[Pasted text #2]'.length,
          content: 'second',
        }),
      ],
    })

    expect(submission.text).toBe('first and second')
  })

  test('an unsettled image keeps its tag in the text', () => {
    const text = 'look [Image #1]'
    const submission = draftSubmissionOf({
      text,
      tokens: [
        {
          id: 1,
          start: 5,
          end: 15,
          ordinal: 1,
          slot: { kind: 'image', ordinal: 1, settled: false, image: null },
        },
      ],
    })

    expect(submission.text).toBe('look [Image #1]')
    expect(submission.images).toEqual([])
  })

  test('no tokens returns the trimmed text', () => {
    expect(draftSubmissionOf({ text: '  hello  ', tokens: [] })).toEqual({
      text: 'hello',
      images: [],
    })
  })
})
