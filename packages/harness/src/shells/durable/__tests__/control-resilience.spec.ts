import { afterEach, describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'

import { inspectDurableShell, sendControl } from '../client'
import { createSocketRequester } from '../connection'
import { createHandle, type DurableShellHandle } from '../handle'
import {
  EControlError,
  ELeaseMode,
  LEASE_DIR,
  LOST_EXIT_CODE,
  TOKEN_FILE,
  type ControlResult,
  type ControlTransport,
} from '../protocol'
import { collect, launchOrThrow, scratchDirectory } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(): Promise<string> {
  const made = await scratchDirectory()
  cleanups.push(made.cleanup)
  return made.shellDir
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function attachWith({
  shellDir,
  transport,
  clientId,
}: {
  shellDir: string
  transport: ControlTransport
  clientId: string
}): Promise<DurableShellHandle> {
  const inspected = await inspectDurableShell({ shellDir })
  if (inspected.meta === undefined) throw new Error('no meta')
  const token = (await readFile(join(shellDir, TOKEN_FILE), 'utf8')).trim()
  return createHandle({
    shellDir,
    identity: inspected.meta.identity,
    pid: inspected.meta.child.pid,
    meta: inspected.meta,
    token,
    terminal: undefined,
    lostReason: undefined,
    cursor: 0,
    clientId,
    pollMs: 20,
    livenessMs: 30,
    transport,
    leaseMode: ELeaseMode.File,
  })
}

const forward =
  ({ shellDir }: { shellDir: string }): ControlTransport =>
  ({ request }) =>
    sendControl({ directory: shellDir, request })

describe('tri-state supervisor liveness', () => {
  test('failed, thrown and probe-less probes never settle a live shell as lost', async () => {
    const shellDir = await scratch()
    const first = await launchOrThrow({ shellDir, command: 'sleep 0.6; echo finished; exit 7' })
    await first.detach()
    const failures: Array<() => Promise<ControlResult>> = [
      async () => ({ ok: false, code: EControlError.Unreachable, message: 'blip' }),
      async () => {
        throw new Error('transport exploded')
      },
      async () => ({ ok: true }),
      async () => ({ ok: false, code: EControlError.Timeout, message: 'slow' }),
    ]
    let probes = 0
    const handle = await attachWith({
      shellDir,
      clientId: 'tri-state',
      transport: async ({ request }) => {
        if (request.type !== 'probe') return sendControl({ directory: shellDir, request })
        const failure = failures[probes]
        probes += 1
        return failure === undefined ? sendControl({ directory: shellDir, request }) : failure()
      },
    })
    const early = await Promise.race([handle.settled.then((value) => value.kind), pause(200).then(() => 'pending')])
    expect(early).toBe('pending')
    expect(await collect({ stream: handle.stdout })).toBe('finished\n')
    expect((await handle.settled).kind).toBe('exited')
    expect(await handle.exited).toBe(7)
    expect(probes).toBeGreaterThan(failures.length)
  })

  test('a positive supervisorAlive false without a recorded exit settles as lost', async () => {
    const shellDir = await scratch()
    const first = await launchOrThrow({ shellDir, command: 'sleep 30' })
    await first.detach()
    const handle = await attachWith({
      shellDir,
      clientId: 'positive-dead',
      transport: async ({ request }) =>
        request.type === 'probe'
          ? { ok: true, probe: { supervisorAlive: false, childAlive: false, reachable: false } }
          : sendControl({ directory: shellDir, request }),
    })
    expect((await handle.settled).kind).toBe('lost')
    expect(await handle.exited).toBe(LOST_EXIT_CODE)
    await sendControl({ directory: shellDir, request: { type: 'kill' } })
  })
})

describe('file lease lifecycle', () => {
  test('immediate detach leaves no lease file behind for any of twenty handles', async () => {
    const shellDir = await scratch()
    const first = await launchOrThrow({ shellDir, command: 'sleep 30' })
    await first.detach()
    const handles = await Promise.all(
      Array.from({ length: 20 }, (_, index) => attachWith({ shellDir, transport: forward({ shellDir }), clientId: `quick-${index}` })),
    )
    await Promise.all(handles.map((handle) => handle.detach()))
    await pause(300)
    expect(await readdir(join(shellDir, LEASE_DIR)).catch(() => [])).toEqual([])
    await sendControl({ directory: shellDir, request: { type: 'kill' } })
  })

  test('the initial beat lands for an attached handle and is removed on detach', async () => {
    const shellDir = await scratch()
    const first = await launchOrThrow({ shellDir, command: 'sleep 30' })
    await first.detach()
    const handle = await attachWith({ shellDir, transport: forward({ shellDir }), clientId: 'steady' })
    await pause(150)
    expect(await readdir(join(shellDir, LEASE_DIR))).toEqual(['steady.lease'])
    await handle.detach()
    expect(await readdir(join(shellDir, LEASE_DIR))).toEqual([])
    await sendControl({ directory: shellDir, request: { type: 'kill' } })
  })
})

describe('requester against a silent server', () => {
  async function blackhole(): Promise<{ path: string; sockets: Socket[] }> {
    const shellDir = await scratch()
    const path = join(shellDir, '..', 'hole.sock')
    const sockets: Socket[] = []
    const server = createServer((socket) => {
      sockets.push(socket)
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve) => server.listen(path, resolve))
    cleanups.push(async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    return { path, sockets }
  }

  test('a server that accepts but never answers hello times out, and a later request reconnects', async () => {
    const { path, sockets } = await blackhole()
    const requester = createSocketRequester({ socketPath: path, token: 't', identity: 'i', timeoutMs: 100 })
    const startedAt = Date.now()
    const first = await requester.request({ request: { type: 'heartbeat' } })
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.code).toBe(EControlError.Timeout)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    const second = await requester.request({ request: { type: 'heartbeat' } })
    expect(second.ok).toBe(false)
    expect(sockets.length).toBe(2)
    requester.close()
  })

  test('close while hello is pending resolves the waiting request immediately', async () => {
    const { path } = await blackhole()
    const requester = createSocketRequester({ socketPath: path, token: 't', identity: 'i', timeoutMs: 10_000 })
    const waiting = requester.request({ request: { type: 'heartbeat' } })
    await pause(50)
    requester.close()
    const result = await Promise.race([waiting, pause(1_000).then(() => 'hung' as const)])
    expect(result).not.toBe('hung')
    expect(typeof result === 'object' && result.ok).toBe(false)
  })
})
