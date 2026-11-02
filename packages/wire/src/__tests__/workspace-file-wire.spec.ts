import { describe, expect, it } from 'bun:test'

import {
  EClientRequest,
  readWorkspaceFileParamsSchema,
  readWorkspaceFileReplySchema,
} from '../index'

describe('workspace file wire schemas', () => {
  it('names the op', () => {
    expect(String(EClientRequest.ReadWorkspaceFile)).toBe('read-workspace-file')
  })

  it('wants exactly a path', () => {
    expect(readWorkspaceFileParamsSchema.safeParse({ path: 'a.ts' }).success).toBe(true)
    expect(readWorkspaceFileParamsSchema.safeParse({}).success).toBe(false)
    expect(readWorkspaceFileParamsSchema.safeParse({ path: 'a', extra: 1 }).success).toBe(false)
  })

  it('accepts a text file and a refusal, and rejects other shapes', () => {
    const text = {
      type: 'text',
      path: 'a',
      content: 'x',
      truncated: false,
      bytes: 1,
    }
    const refused = { type: 'refused', path: 'a', reason: 'it is binary' }
    expect(readWorkspaceFileReplySchema.safeParse({ file: text }).success).toBe(true)
    expect(readWorkspaceFileReplySchema.safeParse({ file: refused }).success).toBe(true)
    expect(readWorkspaceFileReplySchema.safeParse({ file: { type: 'listing' } }).success).toBe(
      false,
    )
    expect(
      readWorkspaceFileReplySchema.safeParse({
        file: { ...text, bytes: undefined },
      }).success,
    ).toBe(false)
  })
})
