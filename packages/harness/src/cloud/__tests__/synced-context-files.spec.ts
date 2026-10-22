import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { ContextReader } from '../../files/session-context'
import { createSessionContextReader } from '../../files/session-context'
import { contextDirectory } from '../../store/sessions/paths'
import { registryFor } from '../../store/sessions/registry'
import { SyncedContextFiles } from '../synced-context-files'

const THREAD = toThreadId('synced-context-thread')

type FakeMirror = {
  converges: number
  failConverge: boolean
  listeners: Set<() => void>
  converge: () => Promise<void>
  subscribe: (listener: () => void) => () => void
  current: () => { revision: number } | undefined
  emit: () => void
}

const fakeMirror = (): FakeMirror => {
  const mirror: FakeMirror = {
    converges: 0,
    failConverge: false,
    listeners: new Set(),
    converge: async () => {
      mirror.converges += 1
      if (mirror.failConverge) throw new Error('the channel is down')
    },
    subscribe: (listener) => {
      mirror.listeners.add(listener)
      return () => { mirror.listeners.delete(listener) }
    },
    current: () => undefined,
    emit: () => { for (const listener of [...mirror.listeners]) listener() },
  }
  return mirror
}

const remoteOf = (files: Record<string, string>): ContextReader => ({
  list: async () => Object.keys(files).map((name) => ({ name, isDirectory: false })),
  load: async (path) => {
    const content = files[path]
    return content === undefined
      ? { type: 'refused', reason: 'the file does not exist' }
      : { type: 'text', content, truncated: false }
  },
  subscribe: () => () => undefined,
})

describe('SyncedContextFiles', () => {
  const homes: string[] = []
  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
  })

  const setup = async (args: { remote?: Record<string, string> } = {}) => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-synced-context-'))
    homes.push(home)
    const sessionDir = await registryFor({ home }).sessionDirFor({ threadId: THREAD })
    const root = contextDirectory({ sessionDir })
    const mirror = fakeMirror()
    const files = new SyncedContextFiles({
      local: createSessionContextReader({ threadId: THREAD, home }),
      remote: remoteOf(args.remote ?? {}),
      mirror,
    })
    const write = async (path: string, content: string): Promise<void> => {
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
    return { files, mirror, write }
  }

  it('reads the mirrored directory after converging', async () => {
    const { files, mirror, write } = await setup()
    await write('plan.md', 'the plan')
    await write('notes/a.md', 'note a')

    expect(await files.list()).toEqual([
      { name: 'notes', isDirectory: true },
      { name: 'plan.md', isDirectory: false },
    ])
    expect(await files.list('notes')).toEqual([{ name: 'a.md', isDirectory: false }])
    expect(await files.load('plan.md')).toEqual({ type: 'text', content: 'the plan', truncated: false })
    expect(mirror.converges).toBe(3)
  })

  it('still reads locally when converge fails', async () => {
    const { files, mirror, write } = await setup()
    await write('plan.md', 'the plan')
    mirror.failConverge = true

    expect(await files.load('plan.md')).toEqual({ type: 'text', content: 'the plan', truncated: false })
  })

  it('falls back to the remote when the local copy is missing', async () => {
    const { files } = await setup({ remote: { 'remote-only.md': 'from the sandbox' } })

    expect(await files.load('remote-only.md')).toEqual({
      type: 'text',
      content: 'from the sandbox',
      truncated: false,
    })
    expect(await files.list()).toEqual([{ name: 'remote-only.md', isDirectory: false }])
  })

  it('keeps the local refusal when the remote cannot answer either', async () => {
    const { files } = await setup()
    const unreachable = new SyncedContextFiles({
      local: { list: async () => [], load: async () => ({ type: 'refused', reason: 'missing' }), subscribe: () => () => undefined },
      remote: {
        list: async () => { throw new Error('parked') },
        load: async () => { throw new Error('parked') },
        subscribe: () => () => undefined,
      },
      mirror: fakeMirror(),
    })

    expect(await unreachable.load('x.md')).toEqual({ type: 'refused', reason: 'missing' })
    expect(await unreachable.list()).toEqual([])
    expect(await files.load('absent.md')).toMatchObject({ type: 'refused' })
  })

  it('notifies subscribers when the mirror emits, until unsubscribed', async () => {
    const { files, mirror } = await setup()
    let heard = 0
    const stop = files.subscribe(() => { heard += 1 })

    mirror.emit()
    expect(heard).toBe(1)

    stop()
    mirror.emit()
    expect(heard).toBe(1)
  })
})
