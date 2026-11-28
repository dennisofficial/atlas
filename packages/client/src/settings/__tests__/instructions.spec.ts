import { describe, expect, it } from 'bun:test'

import {
  INSTRUCTIONS_CHAR_LIMIT,
  INSTRUCTIONS_PATH,
  canSaveInstructions,
  charCountOf,
  instructionsOf,
} from '../instructions'

const decode = (encoded: string): string => Buffer.from(encoded, 'base64').toString('utf8')

describe('instructions char count', () => {
  it('shows the count against the limit', () => {
    expect(charCountOf({ length: 1200, limit: INSTRUCTIONS_CHAR_LIMIT })).toEqual({
      text: '1,200 / 8,000',
      over: false,
    })
  })

  it('reports how far over the limit a document is', () => {
    expect(charCountOf({ length: 8020, limit: INSTRUCTIONS_CHAR_LIMIT })).toEqual({
      text: '8,020 / 8,000, 20 over',
      over: true,
    })
    expect(charCountOf({ length: 8020, limit: INSTRUCTIONS_CHAR_LIMIT }).text).not.toContain(
      '\u00b7',
    )
  })

  it('treats the limit itself as within it', () => {
    expect(charCountOf({ length: 8000, limit: 8000 }).over).toBe(false)
  })
})

describe('canSaveInstructions', () => {
  const base = { dirty: true, length: 10, limit: 8000, saving: false }

  it('saves a dirty document within the limit', () => {
    expect(canSaveInstructions(base)).toBe(true)
  })

  it('refuses a clean, over-limit or saving document', () => {
    expect(canSaveInstructions({ ...base, dirty: false })).toBe(false)
    expect(canSaveInstructions({ ...base, length: 8001 })).toBe(false)
    expect(canSaveInstructions({ ...base, saving: true })).toBe(false)
  })
})

describe('instructionsOf', () => {
  it('returns an empty document at revision zero when the file is missing', () => {
    expect(instructionsOf({ files: [], decode })).toEqual({ text: '', revision: 0 })
  })

  it('decodes the live document and keeps its revision', () => {
    const content = Buffer.from('# Global\n', 'utf8').toString('base64')
    const doc = instructionsOf({
      files: [
        { path: INSTRUCTIONS_PATH, revision: 7, content, tombstonedAt: null },
        { path: '.atlas/other.md', revision: 2, content, tombstonedAt: null },
      ],
      decode,
    })
    expect(doc).toEqual({ text: '# Global\n', revision: 7 })
  })

  it('reads a tombstoned file as empty at its revision', () => {
    const content = Buffer.from('old', 'utf8').toString('base64')
    expect(
      instructionsOf({
        files: [
          {
            path: INSTRUCTIONS_PATH,
            revision: 3,
            content,
            tombstonedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        decode,
      }),
    ).toEqual({ text: '', revision: 3 })
  })
})
