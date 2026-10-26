import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'

import { crawlDirectories } from '../file-tree-crawl'
import type { FileTreeChannel, TreeEntry } from '../file-tree-source'

const TREE: Record<string, TreeEntry[]> = {
  '': [
    { name: 'src', isDirectory: true },
    { name: 'a.md', isDirectory: false },
  ],
  src: [
    { name: 'deep', isDirectory: true },
    { name: 'b.ts', isDirectory: false },
  ],
  'src/deep': [{ name: 'c.ts', isDirectory: false }],
}

function channelOf(tree: Record<string, TreeEntry[]>) {
  const asked: string[] = []
  const channel: FileTreeChannel = {
    request: async ({ op, params }) => {
      if (op !== EClientRequest.BrowseDirectory) throw new Error('unexpected op')
      const directory = (params as { directory: string }).directory
      asked.push(directory)
      const entries = tree[directory]
      if (entries === undefined) throw new Error('missing')
      return { directory, entries }
    },
  }
  return { channel, asked }
}

describe('crawlDirectories', () => {
  it('walks every directory breadth-first over BrowseDirectory', async () => {
    const { channel, asked } = channelOf(TREE)
    const seen: string[] = []
    await crawlDirectories({
      channel,
      isCancelled: () => false,
      onListing: ({ directory }) => seen.push(directory),
    })
    expect(asked).toEqual(['', 'src', 'src/deep'])
    expect(seen).toEqual(['', 'src', 'src/deep'])
  })

  it('stops at the directory limit', async () => {
    const { channel, asked } = channelOf(TREE)
    await crawlDirectories({
      channel,
      isCancelled: () => false,
      onListing: () => undefined,
      limit: 2,
    })
    expect(asked).toEqual(['', 'src'])
  })

  it('rejects when the root cannot be listed', async () => {
    const { channel } = channelOf({})
    await expect(
      crawlDirectories({ channel, isCancelled: () => false, onListing: () => undefined }),
    ).rejects.toThrow('missing')
  })

  it('skips a nested directory that fails and keeps going', async () => {
    const { channel } = channelOf({
      '': [
        { name: 'gone', isDirectory: true },
        { name: 'x', isDirectory: false },
      ],
    })
    const seen: string[] = []
    await crawlDirectories({
      channel,
      isCancelled: () => false,
      onListing: ({ directory }) => seen.push(directory),
    })
    expect(seen).toEqual([''])
  })

  it('stops delivering once cancelled', async () => {
    const { channel } = channelOf(TREE)
    const seen: string[] = []
    await crawlDirectories({
      channel,
      isCancelled: () => true,
      onListing: ({ directory }) => seen.push(directory),
    })
    expect(seen).toEqual([])
  })
})
