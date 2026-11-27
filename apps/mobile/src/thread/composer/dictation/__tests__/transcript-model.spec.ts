import { describe, expect, it } from 'bun:test'

import {
  applyFinalOf,
  applyPartialOf,
  EMPTY_TRANSCRIPT,
  joinWords,
  transcriptKeyOf,
  transcriptTextOf,
} from '../transcript-model'

describe('joinWords', () => {
  it('keeps a single word as it is', () => {
    expect(joinWords({ head: '', word: 'Open' })).toBe('Open')
  })

  it('separates two words with one space', () => {
    expect(joinWords({ head: 'Open', word: 'a' })).toBe('Open a')
  })

  it('ignores an empty word and a padded word', () => {
    expect(joinWords({ head: 'Open', word: '   ' })).toBe('Open')
    expect(joinWords({ head: 'Open', word: ' a ' })).toBe('Open a')
  })
})

describe('applyPartialOf', () => {
  it('replaces the interim words and leaves the committed text alone', () => {
    const first = applyPartialOf({ transcript: EMPTY_TRANSCRIPT, partial: 'Open' })
    const second = applyPartialOf({ transcript: first, partial: 'Open a PR' })
    expect(second).toEqual({ committed: '', interim: 'Open a PR' })
  })
})

describe('applyFinalOf', () => {
  it('replaces the committed text with the words the engine heard and clears the interim', () => {
    const started = applyPartialOf({ transcript: EMPTY_TRANSCRIPT, partial: 'Open a' })
    const committed = applyFinalOf({ transcript: started, final: 'Open a PR' })
    expect(committed).toEqual({ committed: 'Open a PR', interim: '' })
  })

  it('keeps the longer committed text that the engine grows word by word', () => {
    const first = applyFinalOf({ transcript: EMPTY_TRANSCRIPT, final: 'Open a PR' })
    const second = applyFinalOf({
      transcript: first,
      final: 'Open a PR that moves the tRPC router',
    })
    expect(second.committed).toBe('Open a PR that moves the tRPC router')
  })

  it('keeps the words it already holds when the final is empty', () => {
    const transcript = { committed: 'Open a PR', interim: 'that moves' }
    expect(applyFinalOf({ transcript, final: '  ' })).toEqual({
      committed: 'Open a PR',
      interim: '',
    })
  })
})

describe('transcriptTextOf', () => {
  it('joins the committed and interim words', () => {
    expect(transcriptTextOf({ committed: 'Open a PR', interim: 'that' })).toBe('Open a PR that')
  })

  it('reads as the committed text while the interim is empty', () => {
    expect(transcriptTextOf({ committed: 'Open a PR', interim: '' })).toBe('Open a PR')
  })
})

describe('transcriptKeyOf', () => {
  it('tells a moved interim word from a committed one', () => {
    const before = transcriptKeyOf({ committed: 'Open a', interim: 'PR' })
    const after = transcriptKeyOf({ committed: 'Open a PR', interim: '' })
    expect(before).not.toBe(after)
  })
})
