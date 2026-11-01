import { describe, expect, it } from 'bun:test'

import { orphanedInputsOf, type ForkEvent } from '../fork-orphans'

const said = (args: {
  seq: number
  text: string
  requestId?: string
  extra?: object
}): ForkEvent => ({
  seq: args.seq,
  type: 'user-said',
  body: {
    type: 'user-said',
    text: args.text,
    ...(args.requestId === undefined ? {} : { requestId: args.requestId }),
    ...args.extra,
  },
})

const other = (seq: number, type: string): ForkEvent => ({ seq, type, body: { type } })

describe('orphanedInputsOf', () => {
  it('returns a remote user-said whose requestId no local user-said carries', () => {
    const result = orphanedInputsOf({
      remote: [said({ seq: 466, text: 'hmr?', requestId: 'Y' })],
      local: [said({ seq: 466, text: 'Lets see', requestId: 'X' })],
    })

    expect(result.inputs).toEqual([{ text: 'hmr?', requestId: 'Y' }])
    expect(result.discarded).toEqual([])
  })

  it('skips a remote user-said whose requestId already landed locally at any seq', () => {
    const result = orphanedInputsOf({
      remote: [said({ seq: 466, text: 'hmr?', requestId: 'Y' })],
      local: [said({ seq: 470, text: 'hmr?', requestId: 'Y' })],
    })

    expect(result.inputs).toEqual([])
  })

  it('treats a remote user-said without a requestId as orphaned unless a local one has equal text', () => {
    const remote = [said({ seq: 5, text: 'same' }), said({ seq: 6, text: 'different' })]
    const result = orphanedInputsOf({
      remote,
      local: [said({ seq: 5, text: 'same', requestId: 'Z' })],
    })

    expect(result.inputs).toEqual([{ text: 'different' }])
  })

  it('keeps remote order and carries images, files and uploads', () => {
    const upload = {
      uploadId: '3f1c0a52-9a3e-4c8e-8d57-0d6a1d3f9c11',
      pathname: 'u/a.txt',
      name: 'a.txt',
      size: 3,
      mediaType: 'text/plain',
    }
    const image = { path: 'a.png', mediaType: 'image/png', data: 'AA==' }
    const result = orphanedInputsOf({
      remote: [
        said({ seq: 7, text: 'first', requestId: 'A', extra: { uploads: [upload] } }),
        said({ seq: 8, text: 'second', requestId: 'B', extra: { images: [image] } }),
      ],
      local: [],
    })

    expect(result.inputs).toEqual([
      { text: 'first', requestId: 'A', uploads: [upload] },
      { text: 'second', requestId: 'B', images: [image] },
    ])
  })

  it('reports non-input remote events as discarded with their seq and type', () => {
    const result = orphanedInputsOf({
      remote: [
        other(9, 'pr-event'),
        said({ seq: 10, text: 'x', requestId: 'A' }),
        other(11, 'assistant-said'),
      ],
      local: [],
    })

    expect(result.inputs).toEqual([{ text: 'x', requestId: 'A' }])
    expect(result.discarded).toEqual([
      { seq: 9, type: 'pr-event' },
      { seq: 11, type: 'assistant-said' },
    ])
  })

  it('returns one input for a requestId repeated within the remote tail', () => {
    const result = orphanedInputsOf({
      remote: [
        said({ seq: 1, text: 'a', requestId: 'A' }),
        said({ seq: 2, text: 'a', requestId: 'A' }),
      ],
      local: [],
    })

    expect(result.inputs).toHaveLength(1)
  })

  it('discards a user-said whose body is unreadable instead of throwing', () => {
    const result = orphanedInputsOf({
      remote: [{ seq: 3, type: 'user-said', body: 'not an object' }],
      local: [],
    })

    expect(result).toEqual({ inputs: [], discarded: [{ seq: 3, type: 'user-said' }] })
  })
})
