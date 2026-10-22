import { afterEach, describe, expect, it } from 'bun:test'
import { EConnectionView } from '../connection-view'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { SessionManifestReply } from '@dltech/atlas-wire'

import type { ChannelListener } from '../../channel/delta-channel'
import { type ChannelConnection, type ChannelReady } from '../remote-delta-channel'
import { readMirrorStamp } from '../session-mirror-stamp'
import { createSessionMirrorSync, type SessionMirrorSync } from '../session-mirror-syncer'
import { sessionMirrorWriter } from '../session-mirror-writer'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const THREAD: ThreadId = toThreadId('thr_mirror')

const threadMetaJson = (id: string): string =>
  JSON.stringify({
    id,
    title: null,
    head: 0,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    parentThreadId: null,
    forkSeq: null,
    forkMode: null,
    spawnerThreadId: null,
    agentType: null,
    workspace: null,
    repo: null,
    modelRef: null,
    modelEffort: null,
    executionLocation: null,
  })

type ServedFile = { content: string }

type FakeServe = {
  files: Map<string, ServedFile>
  revision: number
}

const sha256Of = (content: string): string => createHash('sha256').update(content).digest('hex')

const manifestOf = (serve: FakeServe): SessionManifestReply => ({
  revision: serve.revision,
  files: [...serve.files.entries()]
    .map(([path, file]) => ({ path, bytes: Buffer.byteLength(file.content), sha256: sha256Of(file.content) }))
    .sort((left, right) => left.path.localeCompare(right.path)),
})

type FakeChannel = {
  connection(): ChannelConnection
  onConnection(listener: (connection: ChannelConnection) => void): () => void
  onReload(listener: () => void): () => void
  onReady(listener: (ready: ChannelReady) => void): () => void
  subscribe(args: { threadId: ThreadId; listener: ChannelListener }): () => void
  request(args: { op: string; params: unknown }): Promise<unknown>
  emit(signal: { type: string; revision?: number }): void
  open(): void
  close(): void
  reload(): void
}

function fakeChannel(serve: FakeServe): FakeChannel {
  const listeners = new Set<ChannelListener>()
  const connectionListeners = new Set<(connection: ChannelConnection) => void>()
  const reloadListeners = new Set<() => void>()
  const readyListeners = new Set<(ready: ChannelReady) => void>()
  let state: ChannelConnection = { state: EConnectionView.Connected, detail: null }
  const moveTo = (next: ChannelConnection): void => {
    state = next
    for (const listener of [...connectionListeners]) listener(state)
  }
  return {
    connection: () => state,
    onConnection(listener) {
      connectionListeners.add(listener)
      return () => {
        connectionListeners.delete(listener)
      }
    },
    onReload(listener) {
      reloadListeners.add(listener)
      return () => {
        reloadListeners.delete(listener)
      }
    },
    onReady(listener) {
      readyListeners.add(listener)
      return () => {
        readyListeners.delete(listener)
      }
    },
    subscribe({ listener }) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async request({ op, params }) {
      if (op === 'read-session-manifest') return manifestOf(serve)
      if (op === 'read-session-files') {
        const { paths } = params as { paths: string[] }
        const files = paths.flatMap((path) => {
          const held = serve.files.get(path)
          return held === undefined ? [] : [{ path, encoding: 'utf8', content: held.content }]
        })
        return { revision: serve.revision, files, missing: paths.filter((path) => !serve.files.has(path)) }
      }
      throw new Error(`unexpected op: ${op}`)
    },
    emit(signal) {
      for (const listener of [...listeners]) listener(signal as never)
    },
    open() {
      moveTo({ state: EConnectionView.Connected, detail: null })
    },
    close() {
      moveTo({ state: EConnectionView.Reconnecting, detail: null })
    },
    reload() {
      for (const listener of [...reloadListeners]) listener()
    },
  }
}

async function fixture(given: { files: Record<string, string>; revision?: number }): Promise<{
  serve: FakeServe
  channel: FakeChannel
  syncer: SessionMirrorSync
  sessionDir: string
}> {
  const home = await mkdtemp(join(tmpdir(), 'atlas-mirror-'))
  homes.push(home)
  const serve: FakeServe = {
    files: new Map(Object.entries(given.files).map(([path, content]) => [path, { content }])),
    revision: given.revision ?? 1,
  }
  const channel = fakeChannel(serve)
  const writer = sessionMirrorWriter({ home: () => home })
  const syncer = createSessionMirrorSync({ channel: channel as never, writer, threadId: THREAD })
  const sessionDir = await writer.sessionDirFor({ threadId: THREAD })
  return { serve, channel, syncer, sessionDir }
}

describe('the session-directory mirror', () => {
  it('converges an empty mirror to the remote session directory', async () => {
    const { syncer, sessionDir } = await fixture({
      files: {
        'meta.json': '{"format":1}',
        'threads/thr_mirror.meta.json': threadMetaJson('thr_mirror'),
        'context/plan.md': '# plan\n',
      },
    })

    syncer.kick()
    await syncer.converge()

    await expect(readFile(join(sessionDir, 'meta.json'), 'utf8')).resolves.toBe('{"format":1}')
    await expect(readFile(join(sessionDir, 'context/plan.md'), 'utf8')).resolves.toBe('# plan\n')
    const stamp = await readMirrorStamp({ sessionDir })
    expect(stamp?.revision).toBe(1)
    expect(Object.keys(stamp?.files ?? {}).sort()).toEqual([
      'context/plan.md',
      'meta.json',
      'threads/thr_mirror.meta.json',
    ])
  })

  it('pulls only the files a delta signal changed', async () => {
    const { serve, channel, syncer, sessionDir } = await fixture({
      files: { 'meta.json': '{"format":1}', 'context/plan.md': '# v1\n' },
    })
    syncer.kick()
    await syncer.converge()

    serve.files.set('context/plan.md', { content: '# v2\n' })
    serve.revision = 2
    channel.emit({ type: 'session-files-changed', revision: 2 })
    await syncer.converge()

    await expect(readFile(join(sessionDir, 'context/plan.md'), 'utf8')).resolves.toBe('# v2\n')
    const stamp = await readMirrorStamp({ sessionDir })
    expect(stamp?.revision).toBe(2)
  })

  it('deletes a mirrored file the remote dropped', async () => {
    const { serve, channel, syncer, sessionDir } = await fixture({
      files: { 'context/a.md': 'a', 'context/b.md': 'b' },
    })
    syncer.kick()
    await syncer.converge()

    serve.files.delete('context/b.md')
    serve.revision = 2
    channel.emit({ type: 'session-files-changed', revision: 2 })
    await syncer.converge()

    await expect(readFile(join(sessionDir, 'context/b.md'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(sessionDir, 'context/a.md'), 'utf8')).resolves.toBe('a')
  })

  it('discards and re-pulls a corrupted mirrored file instead of merging', async () => {
    const { syncer, sessionDir } = await fixture({ files: { 'context/plan.md': '# plan\n' } })
    syncer.kick()
    await syncer.converge()

    await writeFile(join(sessionDir, 'context/plan.md'), '# tampered\n')
    syncer.kick()
    await syncer.converge()

    await expect(readFile(join(sessionDir, 'context/plan.md'), 'utf8')).resolves.toBe('# plan\n')
  })

  it('never writes the event log or the session lock, even when the remote names them', async () => {
    const { serve, syncer, sessionDir } = await fixture({
      files: { 'meta.json': '{}' },
    })
    serve.files.set('threads/thr_mirror.events.jsonl', { content: '{"forged":true}\n' })
    serve.files.set('lock', { content: 'pid 9' })
    serve.revision = 2

    syncer.kick()
    await syncer.converge()

    await expect(readFile(join(sessionDir, 'threads/thr_mirror.events.jsonl'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(sessionDir, 'lock'), 'utf8')).rejects.toThrow()
    const stamp = await readMirrorStamp({ sessionDir })
    expect(stamp?.files['threads/thr_mirror.events.jsonl']).toBeDefined()
  })

  it('reconnects and catches up to a remote change made while the channel was down', async () => {
    const { serve, channel, syncer, sessionDir } = await fixture({
      files: { 'meta.json': '{"format":1}', 'context/plan.md': '# v1\n' },
    })
    syncer.kick()
    await syncer.converge()

    channel.close()
    serve.files.set('context/plan.md', { content: '# v2 while down\n' })
    serve.revision = 2
    channel.open()
    await syncer.converge()

    const mirrored = await readFile(join(sessionDir, 'context/plan.md'))
    expect(mirrored.equals(Buffer.from(serve.files.get('context/plan.md')?.content ?? '', 'utf8'))).toBe(true)
    const stamp = await readMirrorStamp({ sessionDir })
    expect(stamp?.revision).toBe(2)
    expect(stamp?.files['context/plan.md']?.sha256).toBe(sha256Of('# v2 while down\n'))
  })

  it('re-syncs on a reload after a remote change', async () => {
    const { serve, channel, syncer, sessionDir } = await fixture({
      files: { 'meta.json': '{"format":1}', 'context/plan.md': '# v1\n' },
    })
    syncer.kick()
    await syncer.converge()

    serve.files.set('context/plan.md', { content: '# v2 after reload\n' })
    serve.revision = 2
    channel.reload()
    await syncer.converge()

    const mirrored = await readFile(join(sessionDir, 'context/plan.md'))
    expect(mirrored.equals(Buffer.from(serve.files.get('context/plan.md')?.content ?? '', 'utf8'))).toBe(true)
    const stamp = await readMirrorStamp({ sessionDir })
    expect(stamp?.revision).toBe(2)
  })

  it('reports recovery only after a reported failure, not on every steady-state sync', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-mirror-'))
    homes.push(home)
    const serve: FakeServe = {
      files: new Map([['meta.json', { content: '{"format":1}' }]]),
      revision: 1,
    }
    const channel = fakeChannel(serve)
    const writer = sessionMirrorWriter({ home: () => home })
    const recovered: string[] = []
    const failures: unknown[] = []
    const syncer = createSessionMirrorSync({
      channel: channel as never,
      writer,
      threadId: THREAD,
      onSyncFailed: (failure) => failures.push(failure),
      onSyncRecovered: () => recovered.push('recovered'),
    })

    syncer.kick()
    await syncer.converge()
    serve.files.set('context/plan.md', { content: '# v2\n' })
    serve.revision = 2
    channel.emit({ type: 'session-files-changed', revision: 2 })
    await syncer.converge()

    expect(failures).toEqual([])
    expect(recovered).toEqual([])
  })

  it('fires onSyncRecovered once a failed sync succeeds again', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-mirror-'))
    homes.push(home)
    const serve: FakeServe = {
      files: new Map([['meta.json', { content: '{"format":1}' }]]),
      revision: 1,
    }
    const channel = fakeChannel(serve)
    const writer = sessionMirrorWriter({ home: () => home })
    const recovered: string[] = []
    const failures: unknown[] = []
    let manifestFails = true
    const flakyChannel = {
      ...channel,
      async request(args: { op: string; params: unknown }): Promise<unknown> {
        if (args.op === 'read-session-manifest' && manifestFails) throw new Error('wire died mid-read')
        return channel.request(args)
      },
    }
    const syncer = createSessionMirrorSync({
      channel: flakyChannel as never,
      writer,
      threadId: THREAD,
      onSyncFailed: (failure) => failures.push(failure),
      onSyncRecovered: () => recovered.push('recovered'),
    })

    syncer.kick()
    await syncer.converge().catch(() => undefined)
    expect(failures).toHaveLength(1)
    expect(recovered).toEqual([])

    manifestFails = false
    syncer.kick()
    await syncer.converge()

    expect(recovered).toEqual(['recovered'])
    await expect(
      readFile(join(await writer.sessionDirFor({ threadId: THREAD }), 'meta.json'), 'utf8'),
    ).resolves.toBe('{"format":1}')
  })

  it('leaves a sibling session directory byte-identical', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-mirror-'))
    homes.push(home)
    const sibling = join(home, 'sessions', 'thr_host')
    await mkdir(join(sibling, 'threads'), { recursive: true })
    const siblingMeta = threadMetaJson('thr_host')
    await writeFile(join(sibling, 'threads', 'thr_host.meta.json'), siblingMeta)
    await writeFile(join(sibling, 'meta.json'), '{"format":1,"id":"thr_host"}')

    const serve: FakeServe = { files: new Map([['meta.json', { content: '{}' }]]), revision: 1 }
    const channel = fakeChannel(serve)
    const writer = sessionMirrorWriter({ home: () => home })
    const syncer = createSessionMirrorSync({ channel: channel as never, writer, threadId: THREAD })
    syncer.kick()
    await syncer.converge()

    await expect(readFile(join(sibling, 'threads', 'thr_host.meta.json'), 'utf8')).resolves.toBe(siblingMeta)
    await expect(readFile(join(sibling, 'meta.json'), 'utf8')).resolves.toBe('{"format":1,"id":"thr_host"}')
  })
})
