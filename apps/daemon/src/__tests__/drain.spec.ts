import { afterEach, describe, expect, it } from 'bun:test'

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FrameQueue, type DaemonSession, sessionOverQueue } from '@dltech/atlas-protocol/testing'

import { daemonTestEnv, spawnDaemon } from '../testing'

const ENTRY = join(import.meta.dir, '../index.ts')
const EPOCH = 3
const KEY = 'k-drain'

type Booted = {
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  port: number
  token: string
  home: string
}

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const boot = async (): Promise<Booted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-daemon-drain-'))
  const env = daemonTestEnv(home)
  const { child, port } = await spawnDaemon({ entry: ENTRY, env })
  cleanups.push(() => {
    child.kill('SIGKILL')
    rmSync(home, { recursive: true, force: true })
  })
  return { child, port, token: env.DAEMON_TOKEN ?? '', home: join(home, 'daemon') }
}

const connect = async (port: number): Promise<DaemonSession> => {
  const queue = new FrameQueue()
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  socket.addEventListener('message', (event) => queue.pushText(String(event.data)))
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('websocket failed')), { once: true })
  })
  const session = sessionOverQueue({
    queue,
    sendText: (text) => socket.send(text),
    close: () => socket.close(),
    closed: new Promise((resolve) =>
      socket.addEventListener('close', (event) =>
        resolve({ code: event.code, reason: event.reason }),
      ),
    ),
  })
  cleanups.push(() => session.close())
  return session
}

const startSleep = async (args: { port: number; token: string }): Promise<void> => {
  const session = await connect(args.port)
  session.send({ kind: 'hello', sessionId: 's', epoch: EPOCH, token: args.token })
  await session.until((frame) => frame.kind === 'hello-reply', { label: 'hello-reply' })
  session.send({
    kind: 'run',
    key: KEY,
    epoch: EPOCH,
    op: { op: 'exec', argv: ['/bin/sh', '-c', 'sleep 2; echo finished'] },
  })
  await session.until((frame) => frame.kind === 'run-reply', { label: 'run-reply' })
}

const postDrain = (args: { port: number; token?: string; body?: string }): Promise<Response> =>
  fetch(`http://127.0.0.1:${args.port}/drain`, {
    method: 'POST',
    headers: args.token === undefined ? {} : { authorization: `Bearer ${args.token}` },
    body: args.body ?? JSON.stringify({ deadlineMs: 30_000 }),
  })

const restOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text
    text += decoder.decode(value, { stream: true })
  }
}

const journalState = (home: string): string => {
  const text = readFileSync(join(home, 'calls', KEY, 'state.json'), 'utf8')
  return JSON.parse(text).state
}

describe('daemon drain', () => {
  it('refuses a bad or missing token and keeps running', async () => {
    const daemon = await boot()
    expect((await postDrain({ port: daemon.port })).status).toBe(403)
    expect((await postDrain({ port: daemon.port, token: 'wrong' })).status).toBe(403)
    const root = await fetch(`http://127.0.0.1:${daemon.port}/`)
    expect(await root.text()).toBe('atlas-daemon')
    expect(daemon.child.exitCode).toBeNull()
  })

  it('exits 0 only after the in-flight call journal is done', async () => {
    const daemon = await boot()
    await startSleep(daemon)
    expect(journalState(daemon.home)).toBe('running')

    const startedAt = Date.now()
    const accepted = await postDrain(daemon)
    expect(accepted.status).toBe(202)
    expect(await accepted.text()).toBe('draining')

    expect(daemon.child.exitCode).toBeNull()
    expect(journalState(daemon.home)).toBe('running')

    expect(await daemon.child.exited).toBe(0)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1500)
    expect(journalState(daemon.home)).toBe('done')
    expect(await restOf(daemon.child.stdout)).toContain('atlas-daemon draining')
  })

  it('answers 409 to a second drain and still answers atlas-daemon while draining', async () => {
    const daemon = await boot()
    await startSleep(daemon)
    expect((await postDrain(daemon)).status).toBe(202)

    expect((await postDrain(daemon)).status).toBe(409)
    const root = await fetch(`http://127.0.0.1:${daemon.port}/`)
    expect(await root.text()).toBe('atlas-daemon')
    expect(daemon.child.exitCode).toBeNull()

    expect(await daemon.child.exited).toBe(0)
  })

  it('exits at once when nothing is in flight and the body has no deadline', async () => {
    const daemon = await boot()
    expect((await postDrain({ port: daemon.port, token: daemon.token, body: 'nope' })).status).toBe(
      202,
    )
    expect(await daemon.child.exited).toBe(0)
  })
})
