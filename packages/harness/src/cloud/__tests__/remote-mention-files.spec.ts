import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { EFileLoad } from '../../files/file-browser'
import { EClientRequest } from '../channel-wire'
import { RemoteMentionFiles } from '../remote-mention-files'

const threadId = toThreadId('thread-cloud')

const asking = (reply: () => Promise<unknown>) => {
  const calls: Array<{ op: EClientRequest; params: unknown }> = []
  const files = new RemoteMentionFiles({
    threadId,
    channel: { request: async (args) => { calls.push(args); return reply() } },
  })
  return { files, calls }
}

describe('RemoteMentionFiles', () => {
  it('lists, checks and loads through the channel with the thread id', async () => {
    const replies = [
      { entries: [{ name: 'only-in-sandbox.txt', isDirectory: false }] },
      { exists: true },
      { file: { type: 'text', path: 'a.txt', content: 'sandbox', truncated: false } },
      { file: { type: 'listing', path: 'src', content: 'a.ts' } },
      { file: { type: 'refused', path: 'x', reason: 'it does not exist' } },
    ]
    const { files, calls } = asking(async () => replies.shift())

    expect(await files.list('src')).toEqual([{ name: 'only-in-sandbox.txt', isDirectory: false }])
    expect(await files.exists('a.txt')).toBe(true)
    expect(await files.load('a.txt')).toEqual({ type: EFileLoad.Text, path: 'a.txt', content: 'sandbox', truncated: false })
    expect(await files.load('src')).toEqual({ type: EFileLoad.Listing, path: 'src', content: 'a.ts' })
    expect(await files.load('x')).toEqual({ type: EFileLoad.Refused, path: 'x', reason: 'it does not exist' })
    expect(calls).toEqual([
      { op: EClientRequest.ListMentionFiles, params: { threadId, directory: 'src' } },
      { op: EClientRequest.MentionFileExists, params: { threadId, path: 'a.txt' } },
      { op: EClientRequest.ReadMentionFile, params: { threadId, path: 'a.txt' } },
      { op: EClientRequest.ReadMentionFile, params: { threadId, path: 'src' } },
      { op: EClientRequest.ReadMentionFile, params: { threadId, path: 'x' } },
    ])
  })

  it('asks again every time instead of caching', async () => {
    const { files, calls } = asking(async () => ({ exists: false }))
    await files.exists('a')
    files.forget()
    await files.exists('a')
    expect(calls).toHaveLength(2)
  })

  it('propagates a failed request rather than answering from anywhere else', async () => {
    const { files } = asking(async () => { throw new Error('the sandbox is parked') })
    await expect(files.list('.')).rejects.toThrow('the sandbox is parked')
    await expect(files.exists('a')).rejects.toThrow('the sandbox is parked')
    await expect(files.load('a')).rejects.toThrow('the sandbox is parked')
  })

  it('rejects a malformed reply', async () => {
    const { files } = asking(async () => ({ unexpected: true }))
    await expect(files.list('.')).rejects.toThrow()
    await expect(files.exists('a')).rejects.toThrow()
    await expect(files.load('a')).rejects.toThrow()
  })
})
