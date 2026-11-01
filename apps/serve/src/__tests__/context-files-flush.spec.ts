import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { createContextFilesFlusher, type MirroredContextTree } from '../context-files-flush'
import type { ServeLogLine } from '../serve-log'

const threadId = toThreadId('thread-context')

type Recorded = {
  puts: { path: string; content: string }[]
  deletes: string[]
  resyncs: string[][]
}

const recorder = (): Recorded & {
  put: (args: { path: string; content: string }) => Promise<void>
  remove: (args: { path: string }) => Promise<void>
  deleteMissing: (args: { keep: readonly string[] }) => Promise<void>
} => {
  const recorded: Recorded = { puts: [], deletes: [], resyncs: [] }
  return {
    ...recorded,
    put: async (args) => {
      recorded.puts.push(args)
    },
    remove: async ({ path }) => {
      recorded.deletes.push(path)
    },
    deleteMissing: async ({ keep }) => {
      recorded.resyncs.push([...keep])
    },
  }
}

const scanOf = (files: Record<string, string>) => {
  return async (): Promise<MirroredContextTree> => ({ textFiles: new Map(Object.entries(files)) })
}

describe('createContextFilesFlusher', () => {
  it('puts every text file and resyncs the keep list on the first flush', async () => {
    const api = recorder()
    const flusher = createContextFilesFlusher({
      threadId,
      root: '/unused',
      ...api,
      scan: scanOf({ 'plan.md': 'v1', 'notes/a.md': 'a' }),
      log: () => undefined,
    })

    expect(await flusher.flush()).toBe(true)
    expect(api.puts).toEqual([
      { path: 'plan.md', content: 'v1' },
      { path: 'notes/a.md', content: 'a' },
    ])
    expect(api.deletes).toEqual([])
    expect(api.resyncs).toEqual([['plan.md', 'notes/a.md']])
  })

  it('puts only changed files, deletes vanished ones, and keeps deletes thread-scoped', async () => {
    const api = recorder()
    let tree: Record<string, string> = { 'plan.md': 'v1', 'notes/a.md': 'a', 'notes/b.md': 'b' }
    const flusher = createContextFilesFlusher({
      threadId,
      root: '/unused',
      ...api,
      scan: async () => ({ textFiles: new Map(Object.entries(tree)) }),
      log: () => undefined,
    })

    expect(await flusher.flush()).toBe(true)
    api.puts.length = 0
    api.deletes.length = 0
    api.resyncs.length = 0

    tree = { 'plan.md': 'v2', 'notes/b.md': 'b' }
    expect(await flusher.flush()).toBe(true)
    expect(api.puts).toEqual([{ path: 'plan.md', content: 'v2' }])
    expect(api.deletes).toEqual(['notes/a.md'])
    expect(api.resyncs).toEqual([['plan.md', 'notes/b.md']])
  })

  it('serializes concurrent flushes and answers the queued one', async () => {
    const api = recorder()
    let resolveScan: (() => void) | undefined
    const flusher = createContextFilesFlusher({
      threadId,
      root: '/unused',
      ...api,
      scan: async () => {
        await new Promise<void>((resolve) => {
          resolveScan = resolve
        })
        return { textFiles: new Map([['plan.md', 'v1']]) }
      },
      log: () => undefined,
    })

    const first = flusher.flush()
    const second = flusher.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    resolveScan?.()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(api.puts).toEqual([{ path: 'plan.md', content: 'v1' }])
  })

  it('logs and answers false when the control plane refuses, then recovers', async () => {
    const api = recorder()
    const lines: ServeLogLine[] = []
    let fail = true
    const flusher = createContextFilesFlusher({
      threadId,
      root: '/unused',
      ...api,
      put: async (args) => {
        if (fail) throw new Error('the control plane answered 401')
        await api.put(args)
      },
      scan: scanOf({ 'plan.md': 'v1' }),
      log: (line) => lines.push(line),
    })

    expect(await flusher.flush()).toBe(false)
    expect(lines.some((line) => line.event === 'serve.context-mirror-failed')).toBe(true)

    fail = false
    expect(await flusher.flush()).toBe(true)
    expect(api.puts).toEqual([{ path: 'plan.md', content: 'v1' }])
  })
})
