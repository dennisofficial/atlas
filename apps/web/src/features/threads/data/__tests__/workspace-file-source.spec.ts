import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'

import { readWorkspaceFile, type WorkspaceFileChannel } from '../workspace-file-source'

const channelOf = (reply: unknown) => {
  const calls: unknown[] = []
  const channel = {
    request: async (request: unknown) => {
      calls.push(request)
      return reply
    },
  } as WorkspaceFileChannel
  return { channel, calls }
}

describe('readWorkspaceFile', () => {
  it('asks for the path and returns the file', async () => {
    const file = {
      type: 'text',
      path: 'a.ts',
      content: 'x',
      truncated: false,
      bytes: 1,
    }
    const { channel, calls } = channelOf({ file })
    expect(await readWorkspaceFile({ channel, path: 'a.ts' })).toEqual(file)
    expect(calls).toEqual([{ op: EClientRequest.ReadWorkspaceFile, params: { path: 'a.ts' } }])
  })

  it('rejects a malformed reply', async () => {
    const { channel } = channelOf({ file: { type: 'listing' } })
    await expect(readWorkspaceFile({ channel, path: 'a' })).rejects.toThrow()
  })
})
