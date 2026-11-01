import { describe, expect, it } from 'bun:test'

import { listContextFilesFromApi, readContextFileFromApi } from '../context-files-source'
import { fakeFetch, queryUrl, trpcOk } from './trpc-fake'

describe('context files API fallback (parked pod)', () => {
  it('lists directory entries through contextFiles.list when there is no channel', async () => {
    const calls = fakeFetch(() => trpcOk({ entries: [{ name: 'plan.md', isDirectory: false }] }))
    const level = await listContextFilesFromApi({ threadId: 'thr-1' })
    expect(level).toEqual({ entries: [{ name: 'plan.md', isDirectory: false }], error: false })
    expect(calls[0]?.url).toBe(
      queryUrl({ procedure: 'contextFiles.list', input: { threadId: 'thr-1' } }),
    )
  })

  it('passes the directory through on a nested list', async () => {
    const calls = fakeFetch(() => trpcOk({ entries: [] }))
    await listContextFilesFromApi({ threadId: 'thr-1', directory: 'notes' })
    expect(calls[0]?.url).toBe(
      queryUrl({
        procedure: 'contextFiles.list',
        input: { threadId: 'thr-1', directory: 'notes' },
      }),
    )
  })

  it('reads a file through contextFiles.read when there is no channel', async () => {
    const calls = fakeFetch(() =>
      trpcOk({ file: { type: 'text', content: 'the plan', truncated: false } }),
    )
    const file = await readContextFileFromApi({ threadId: 'thr-1', path: 'plan.md' })
    expect(file).toEqual({ type: 'text', content: 'the plan', truncated: false })
    expect(calls[0]?.url).toBe(
      queryUrl({ procedure: 'contextFiles.read', input: { threadId: 'thr-1', path: 'plan.md' } }),
    )
  })

  it('answers an error level instead of throwing when the API fails', async () => {
    fakeFetch(() => {
      throw new Error('network down')
    })
    const level = await listContextFilesFromApi({ threadId: 'thr-1' })
    expect(level).toEqual({ entries: [], error: true })
  })
})
