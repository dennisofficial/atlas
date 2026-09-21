import { describe, expect, it } from 'vitest'
import { parseReplyTarget } from './reply-target'

describe('parseReplyTarget', () => {
  it('parses an issue surface id', () => {
    expect(parseReplyTarget('compai/atlas#341')).toEqual({
      owner: 'compai',
      repo: 'atlas',
      issueNumber: 341,
    })
  })

  it('parses a pull-request surface id', () => {
    expect(parseReplyTarget('compai/atlas/pull/87')).toEqual({
      owner: 'compai',
      repo: 'atlas',
      issueNumber: 87,
    })
  })

  it('refuses ids that are not factory surface grammars', async () => {
    const refused = [
      'compai/atlas',
      'compai/atlas#0',
      'compai/atlas#abc',
      'compai/atlas/pull/',
      'compai#341',
      'COMP-88',
      'https://github.com/compai/atlas/issues/341',
      '',
    ]
    for (const id of refused) {
      expect(parseReplyTarget(id), id).toBeNull()
    }
  })
})
