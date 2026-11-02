import { describe, expect, it } from 'bun:test'

import {
  EClientRequest,
  searchWorkspaceFilesParamsSchema,
  searchWorkspaceFilesReplySchema,
} from '../index'

describe('file search wire schemas', () => {
  it('names the op', () => {
    expect(String(EClientRequest.SearchWorkspaceFiles)).toBe('search-workspace-files')
  })

  it('wants a query and an optional bounded limit', () => {
    expect(searchWorkspaceFilesParamsSchema.safeParse({ query: 'a' }).success).toBe(true)
    expect(searchWorkspaceFilesParamsSchema.safeParse({ query: 'a', limit: 200 }).success).toBe(
      true,
    )
    expect(searchWorkspaceFilesParamsSchema.safeParse({ query: 'a', limit: 201 }).success).toBe(
      false,
    )
    expect(searchWorkspaceFilesParamsSchema.safeParse({ query: 'a', limit: 0 }).success).toBe(false)
    expect(searchWorkspaceFilesParamsSchema.safeParse({}).success).toBe(false)
    expect(searchWorkspaceFilesParamsSchema.safeParse({ query: 'a', x: 1 }).success).toBe(false)
  })

  it('accepts a reply of paths with positions and rejects other shapes', () => {
    expect(
      searchWorkspaceFilesReplySchema.safeParse({
        paths: [{ path: 'a.ts', positions: [0, 1] }],
        truncated: false,
      }).success,
    ).toBe(true)
    expect(searchWorkspaceFilesReplySchema.safeParse({ paths: [] }).success).toBe(false)
    expect(
      searchWorkspaceFilesReplySchema.safeParse({
        paths: [{ path: 'a', positions: [-1] }],
        truncated: false,
      }).success,
    ).toBe(false)
  })
})
