import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, afterEach } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import type { ChannelListener } from '../../channel/delta-channel'
import type { ContextReader } from '../../files/session-context'
import { EClientRequest } from '../channel-wire'
import { EChannelConnection, type ChannelConnection } from '../remote-delta-channel'
import { MirroredContextFiles } from '../mirrored-context-files'

const THREAD: ThreadId = toThreadId('context-thread')

type FakeChannel = {
  threadId: ThreadId
  requests: Array<{ op: EClientRequest; params: unknown }>
  remoteFiles: Map<string, string>
  remoteTree: Map<string | undefined, Array<{ name: string; isDirectory: boolean }>>
  listener: ChannelListener | undefined
  checkpoints: Array<(checkpoint: RuntimeCheckpoint) => void>
  connection: () => ChannelConnection
  setConnection: (next: ChannelConnection) => void
  request: (args: { op: EClientRequest; params: unknown }) => Promise<unknown>
  subscribe: (args: { threadId: ThreadId; listener: ChannelListener }) => () => void
  onReload: () => () => void
  onCheckpoint: (listener: (checkpoint: RuntimeCheckpoint) => void) => () => void
}

function fakeChannel(): FakeChannel {
  let connection: ChannelConnection = { state: EChannelConnection.Open, detail: null }
  const channel: FakeChannel = {
    threadId: THREAD,
    requests: [],
    remoteFiles: new Map(),
    remoteTree: new Map(),
    listener: undefined,
    checkpoints: [],
    connection: () => connection,
    setConnection: (next) => { connection = next },
    request: async ({ op, params }) => {
      channel.requests.push({ op, params })
      if (connection.state !== EChannelConnection.Open) throw new Error('the sandbox is parked')
      if (op === EClientRequest.ListContextFiles) {
        const directory = (params as { directory?: string }).directory
        return { entries: channel.remoteTree.get(directory) ?? [] }
      }
      const path = (params as { path: string }).path
      const content = channel.remoteFiles.get(path)
      if (content === undefined) return { file: { type: 'refused', reason: 'the file does not exist' } }
      return { file: { type: 'text', content, truncated: false } }
    },
    subscribe: ({ listener }) => {
      channel.listener = listener
      return () => { channel.listener = undefined }
    },
    onReload: () => () => undefined,
    onCheckpoint: (listener) => {
      channel.checkpoints.push(listener)
      return () => {
        const at = channel.checkpoints.indexOf(listener)
        if (at >= 0) channel.checkpoints.splice(at, 1)
      }
    },
  }
  return channel
}

const seedTree = (channel: FakeChannel, files: Record<string, string>) => {
  const dirs = new Map<string | undefined, Map<string, boolean>>()
  for (const path of Object.keys(files)) {
    channel.remoteFiles.set(path, files[path] ?? '')
    const parts = path.split('/')
    parts.forEach((part, index) => {
      const parent = index === 0 ? undefined : parts.slice(0, index).join('/')
      const listing = dirs.get(parent) ?? new Map<string, boolean>()
      listing.set(part, index < parts.length - 1)
      dirs.set(parent, listing)
    })
  }
  for (const [directory, listing] of dirs) {
    channel.remoteTree.set(
      directory,
      [...listing].map(([name, isDirectory]) => ({ name, isDirectory })),
    )
  }
}

const mirrorDirOf = (home: string) => join(home, 'sessions', THREAD, 'context')

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('MirroredContextFiles', () => {
  const homes: string[] = []
  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
  })

  const makeHome = async (): Promise<string> => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-mirrored-context-'))
    homes.push(home)
    return home
  }

  const makeFiles = (args: { home: string; channel: FakeChannel }): MirroredContextFiles =>
    new MirroredContextFiles({
      channel: args.channel,
      local: {
        list: async (directory) => {
          const root = directory === undefined
            ? mirrorDirOf(args.home)
            : join(mirrorDirOf(args.home), directory)
          const { readdir } = await import('node:fs/promises')
          const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
          return entries
            .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
            .sort((left, right) => left.name.localeCompare(right.name))
        },
        load: async (path) => {
          const text = await readFile(join(mirrorDirOf(args.home), path), 'utf8').catch(() => null)
          return text === null
            ? { type: 'refused', reason: 'the file does not exist' }
            : { type: 'text', content: text, truncated: false }
        },
        subscribe: () => () => undefined,
      } satisfies ContextReader,
      remote: {
        list: async () => [{ name: 'remote-only.md', isDirectory: false }],
        load: async () => ({ type: 'text', content: 'remote fallback\n', truncated: false }),
        subscribe: () => () => undefined,
      } satisfies ContextReader,
      threadId: THREAD,
      home: args.home,
    })

  it('pulls the remote tree once, then answers from the mirror', async () => {
    const home = await makeHome()
    const channel = fakeChannel()
    seedTree(channel, { 'plan.md': '# plan\n', 'specs/one.md': '# one\n' })
    const files = makeFiles({ home, channel })

    expect(await files.list()).toEqual([
      { name: 'plan.md', isDirectory: false },
      { name: 'specs', isDirectory: true },
    ])
    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# plan\n', truncated: false })
    expect(await files.load('specs/one.md')).toEqual({ type: 'text', content: '# one\n', truncated: false })

    const pulls = channel.requests.length
    await files.list()
    await files.load('plan.md')
    expect(channel.requests.length).toBe(pulls)

    expect(await readFile(join(mirrorDirOf(home), 'plan.md'), 'utf8')).toBe('# plan\n')
    expect(await readFile(join(mirrorDirOf(home), 'specs/one.md'), 'utf8')).toBe('# one\n')
  })

  it('first load on an empty mirror falls back to remote and populates it', async () => {
    const home = await makeHome()
    const channel = fakeChannel()
    seedTree(channel, { 'plan.md': '# remote\n' })
    const files = makeFiles({ home, channel })

    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# remote\n', truncated: false })
    expect(await readFile(join(mirrorDirOf(home), 'plan.md'), 'utf8')).toBe('# remote\n')
    expect(channel.requests.some(({ op }) => op === EClientRequest.ListContextFiles)).toBe(true)
  })

  it('never rejects on an empty mirror with a closed channel', async () => {
    const home = await makeHome()
    const channel = fakeChannel()
    seedTree(channel, {})
    channel.setConnection({ state: EChannelConnection.Parked, detail: null })
    const files = makeFiles({ home, channel })

    expect(await files.load('anything.md')).toEqual({ type: 'text', content: 'remote fallback\n', truncated: false })
    expect(await files.list()).toEqual([{ name: 'remote-only.md', isDirectory: false }])
  })

  it('a context-changed signal re-pulls the tree and notifies the listener', async () => {
    const home = await makeHome()
    const channel = fakeChannel()
    seedTree(channel, { 'plan.md': '# v1\n' })
    const files = makeFiles({ home, channel })
    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# v1\n', truncated: false })

    let notified = 0
    files.subscribe(() => { notified += 1 })

    channel.remoteFiles.set('plan.md', '# v2\n')
    channel.listener?.({ type: 'context-changed' })
    expect(notified).toBe(1)
    await settled()

    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# v2\n', truncated: false })
  })

  it('answers from the mirror while the channel is closed', async () => {
    const home = await makeHome()
    const channel = fakeChannel()
    seedTree(channel, { 'plan.md': '# parked\n' })
    const files = makeFiles({ home, channel })
    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# parked\n', truncated: false })

    channel.setConnection({ state: EChannelConnection.Parked, detail: null })
    channel.listener?.({ type: 'context-changed' })
    await settled()

    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# parked\n', truncated: false })
    expect(await files.list()).toEqual([{ name: 'plan.md', isDirectory: false }])
  })

  it('re-pulls the tree when a parked checkpoint arrives', async () => {
    const home = await makeHome()
    const channel = fakeChannel()
    seedTree(channel, { 'plan.md': '# one\n' })
    const files = makeFiles({ home, channel })
    files.subscribe(() => undefined)
    expect(await files.load('plan.md')).toEqual({ type: 'text', content: '# one\n', truncated: false })

    channel.remoteFiles.set('plan.md', '# two\n')
    const parked: RuntimeCheckpoint = {
      threadId: THREAD,
      runtimeId: 'runtime',
      sandboxSessionId: 'sandbox',
      revision: 1,
      phase: ERuntimePhase.Parked,
      reportedAt: new Date().toISOString(),
      transcript: {
        head: 0,
        count: 0,
        digest: '0'.repeat(64),
      },
    }
    for (const notify of channel.checkpoints) notify(parked)
    await settled()
    await settled()

    expect(await readFile(join(mirrorDirOf(home), 'plan.md'), 'utf8')).toBe('# two\n')
  })
})
