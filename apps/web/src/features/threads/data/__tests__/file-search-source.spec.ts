import { describe, expect, it } from 'bun:test'

import { EClientRequest, RemoteRequestFailed } from '@dltech/atlas-client/channel'

import {
  isSearchUnsupported,
  searchWorkspaceFiles,
  type FileSearchChannel,
} from '../file-search-source'

describe('searchWorkspaceFiles', () => {
  it('asks for the query and returns the parsed reply', async () => {
    const calls: unknown[] = []
    const reply = { paths: [{ path: 'a.ts', positions: [0] }], truncated: false }
    const channel = {
      request: async (request: unknown) => {
        calls.push(request)
        return reply
      },
    } as FileSearchChannel
    expect(await searchWorkspaceFiles({ channel, query: 'a' })).toEqual(reply)
    expect(calls).toEqual([{ op: EClientRequest.SearchWorkspaceFiles, params: { query: 'a' } }])
  })

  it('rejects a malformed reply', async () => {
    const channel = { request: async () => ({}) } as FileSearchChannel
    expect(searchWorkspaceFiles({ channel, query: 'a' })).rejects.toThrow()
  })
})

describe('isSearchUnsupported', () => {
  it('recognises an older serve refusing the op', () => {
    const failure = new RemoteRequestFailed({
      op: EClientRequest.SearchWorkspaceFiles,
      data: { message: 'unknown request op: search-workspace-files' },
    })
    expect(isSearchUnsupported(failure)).toBe(true)
    expect(isSearchUnsupported(new Error('boom'))).toBe(false)
  })
})
