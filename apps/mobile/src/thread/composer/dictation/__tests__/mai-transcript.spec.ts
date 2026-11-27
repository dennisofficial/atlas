import { describe, expect, it } from 'bun:test'

import { ETranscriptPart, type TTranscriptPart } from '../gateway-protocol'
import {
  EMPTY_SPOKEN,
  ESpokenSource,
  joinSpoken,
  type ISpoken,
  withTranscriptPart,
} from '../mai-transcript'

const afterOf = (parts: readonly TTranscriptPart[]): ISpoken =>
  parts.reduce<ISpoken>((spoken, part) => withTranscriptPart({ spoken, part }), EMPTY_SPOKEN)

const deltaOf = (delta: string): TTranscriptPart => ({ type: ETranscriptPart.Delta, delta })

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
  it('joins the deltas exactly as they arrive, without inventing spaces', () => {
    expect(afterOf([deltaOf('hel'), deltaOf('lo')]).committed).toBe('hello')
  })

  it('keeps the spacing the service sends inside a sentence', () => {
    expect(afterOf([deltaOf('Hello'), deltaOf(' there'), deltaOf('!')]).committed).toBe(
      'Hello there!',
    )
  })

  it('replaces the committed text with a cumulative final', () => {
    const spoken = afterOf([
      deltaOf('And so'),
      { type: ETranscriptPart.Final, text: 'And so my fellow Americans' },
    ])
    expect(spoken.committed).toBe('And so my fellow Americans')
  })

  it('lets a final correct what the deltas heard', () => {
    const spoken = afterOf([
      deltaOf('I scream'),
      { type: ETranscriptPart.Finish, text: 'Ice cream' },
    ])
    expect(spoken.committed).toBe('Ice cream')
  })

  it('joins a delta with a space when it follows a segment', () => {
    const spoken = afterOf([{ type: ETranscriptPart.Final, text: 'And' }, deltaOf('so')])
    expect(spoken.committed).toBe('And so')
  })

  it('shows a partial as interim and leaves the committed text alone', () => {
    const spoken = afterOf([
      { type: ETranscriptPart.Final, text: 'Ask not' },
      { type: ETranscriptPart.Partial, text: 'what your' },
    ])
    expect(spoken).toEqual({
      committed: 'Ask not',
      interim: 'what your',
      source: ESpokenSource.Segment,
    })
  })

  it('replaces the committed text and clears the interim when a final lands', () => {
    const spoken = withTranscriptPart({
      spoken: { committed: 'Ask not', interim: 'what your', source: ESpokenSource.Segment },
      part: { type: ETranscriptPart.Final, text: 'Ask not what your country can do' },
    })
    expect(spoken).toEqual({
      committed: 'Ask not what your country can do',
      interim: '',
      source: ESpokenSource.Segment,
    })
  })

  it('takes the finish text as the committed text', () => {
    const spoken = withTranscriptPart({
      spoken: { committed: 'Ask not', interim: 'what', source: ESpokenSource.Delta },
      part: { type: ETranscriptPart.Finish, text: 'Ask not what your country can do for you' },
    })
    expect(spoken).toEqual({
      committed: 'Ask not what your country can do for you',
      interim: '',
      source: ESpokenSource.Segment,
    })
  })

  it('leaves the transcript alone for an error part', () => {
    const spoken = afterOf([deltaOf('Ask not')])
    expect(
      withTranscriptPart({ spoken, part: { type: ETranscriptPart.Error, message: 'no' } }),
    ).toBe(spoken)
  })
})
