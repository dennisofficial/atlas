import { describe, expect, it } from 'bun:test'

import {
  MEMORY_EDIT_AMBIGUOUS_CODE,
  MEMORY_EDIT_NO_MATCH_CODE,
  MEMORY_STALE_REVISION_CODE,
  memoryEntrySchema,
  memorySummarySchema,
} from '../record'
import { EMemoryScope, EMemoryType } from '../vocabulary'

const summary = {
  scope: EMemoryScope.Project,
  project: 'acme/widgets',
  name: 'deflate',
  description: 'about deflate',
  type: EMemoryType.Reference,
  revision: 2,
  updatedAt: '2026-11-24T10:00:00.000Z',
}

describe('memory record', () => {
  it('keeps the error codes that clients match on', () => {
    expect([
      MEMORY_STALE_REVISION_CODE,
      MEMORY_EDIT_NO_MATCH_CODE,
      MEMORY_EDIT_AMBIGUOUS_CODE,
    ]).toEqual(['memory-stale-revision', 'memory-edit-no-match', 'memory-edit-ambiguous'])
  })

  it('parses a summary and drops fields it does not own', () => {
    expect(memorySummarySchema.parse({ ...summary, body: 'x', userId: 'u' })).toEqual(summary)
  })

  it('parses an entry with its body', () => {
    expect(memoryEntrySchema.parse({ ...summary, body: 'fact' })).toEqual({
      ...summary,
      body: 'fact',
    })
  })

  it('accepts a global memory with no project', () => {
    expect(
      memorySummarySchema.parse({ ...summary, scope: EMemoryScope.Global, project: null }).project,
    ).toBeNull()
  })

  it('refuses an unknown scope, an unknown kind and a fractional revision', () => {
    for (const bad of [{ scope: 'team' }, { type: 'note' }, { revision: 1.5 }]) {
      expect(memorySummarySchema.safeParse({ ...summary, ...bad }).success).toBe(false)
    }
  })
})
