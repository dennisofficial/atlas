import { describe, expect, it } from 'bun:test'

import {
  filesReadInputSchema,
  filesReadOutputSchema,
  filesSearchOutputSchema,
  filesTreeInputSchema,
  filesTreeOutputSchema,
} from '../files'

const file = {
  type: 'text',
  path: 'src/a.ts',
  content: 'export {}',
  truncated: false,
  bytes: 9,
} as const

describe('files schemas', () => {
  it('round-trips a text file', () => {
    expect(filesReadOutputSchema.parse({ file })).toEqual({ file })
  })

  it('round-trips a tree with the root directory', () => {
    const input = { sessionId: 'ses', directory: '' }
    expect(filesTreeInputSchema.parse(input)).toEqual(input)
    const output = { directory: '', entries: [{ name: 'src', isDirectory: true, changed: false }] }
    expect(filesTreeOutputSchema.parse(output)).toEqual(output)
  })

  it('rejects an empty path on read', () => {
    expect(filesReadInputSchema.safeParse({ sessionId: 'ses', path: '' }).success).toBe(false)
  })

  it('rejects cache fields that no longer exist', () => {
    expect(filesReadOutputSchema.safeParse({ file: { ...file, source: 'cache' } }).success).toBe(
      false,
    )
    expect(filesReadOutputSchema.safeParse({ file: { ...file, waking: true } }).success).toBe(false)
  })

  it('rejects unknown keys on search', () => {
    expect(
      filesSearchOutputSchema.safeParse({ paths: [], truncated: false, source: 'cache' }).success,
    ).toBe(false)
  })
})
