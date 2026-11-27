import { describe, expect, it } from 'bun:test'

import { ETranscriptPart } from '../gateway-protocol'
import { EMPTY_SPOKEN, joinSpoken, withTranscriptPart } from '../mai-transcript'

describe('joinSpoken', () => {
  it('keeps a word off the end of a sentence', () => {
    expect(joinSpoken({ head: 'Hello', next: 'there' })).toBe('Hello there')
  })

  it('pins punctuation to the word before it', () => {
    expect(joinSpoken({ head: 'Hello world', next: '.' })).toBe('Hello world.')
    expect(joinSpoken({ head: 'Hello', next: ', there' })).toBe('Hello, there')
  })
})

describe('withTranscriptPart', () => {
  it('grows the committed text with each delta', () => {
    const first = withTranscriptPart({
      transcript: EMPTY_SPOKEN,
      part: { type: ETranscriptPart.Delta, delta: 'Hello' },
    })
    const second = withTranscriptPart({
      transcript: first,
      part: { type: ETranscriptPart.Delta, delta: '.' },
    })
    expect(second).toEqual({ committed: 'Hello.', interim: '' })
  })

  it('replaces the committed text with a final that carries the whole sentence', () => {
    const afterDeltas = withTranscriptPart({
      transcript: EMPTY_SPOKEN,
      part: { type: ETranscriptPart.Delta, delta: 'And so my fellow Americans' },
    })
    const final = withTranscriptPart({
      transcript: afterDeltas,
      part: { type: ETranscriptPart.Final, text: 'And so my fellow Americans' },
    })
    expect(final.committed).toBe('And so my fellow Americans')
  })

  it('shows a partial as interim and leaves the committed text alone', () => {
    const committed = withTranscriptPart({
      transcript: EMPTY_SPOKEN,
      part: { type: ETranscriptPart.Final, text: 'Ask not' },
    })
    const partial = withTranscriptPart({
      transcript: committed,
      part: { type: ETranscriptPart.Partial, text: 'what your' },
    })
    expect(partial).toEqual({ committed: 'Ask not', interim: 'what your' })
  })

  it('clears the interim when the next final replaces it', () => {
    const partial = withTranscriptPart({
      transcript: { committed: 'Ask not', interim: 'what your' },
      part: { type: ETranscriptPart.Final, text: 'Ask not what your country can do' },
    })
    expect(partial).toEqual({ committed: 'Ask not what your country can do', interim: '' })
  })

  it('appends a final that carries only new words', () => {
    const final = withTranscriptPart({
      transcript: { committed: 'Ask not', interim: '' },
      part: { type: ETranscriptPart.Final, text: 'what your country can do' },
    })
    expect(final.committed).toBe('Ask not what your country can do')
  })

  it('keeps the longer text when the final is a shorter hearing of it', () => {
    const final = withTranscriptPart({
      transcript: { committed: 'Ask not what your country', interim: '' },
      part: { type: ETranscriptPart.Final, text: 'Ask not' },
    })
    expect(final.committed).toBe('Ask not what your country')
  })

  it('takes the finish text as the committed text', () => {
    const finish = withTranscriptPart({
      transcript: { committed: 'Ask not', interim: 'what' },
      part: { type: ETranscriptPart.Finish, text: 'Ask not what your country can do for you' },
    })
    expect(finish).toEqual({ committed: 'Ask not what your country can do for you', interim: '' })
  })

  it('leaves the transcript alone for an error part', () => {
    const transcript = { committed: 'Ask not', interim: 'what' }
    expect(
      withTranscriptPart({ transcript, part: { type: ETranscriptPart.Error, message: 'no' } }),
    ).toBe(transcript)
  })
})
