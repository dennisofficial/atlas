import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  type RestoredWorkspace,
  type ServeFrame,
} from '@dltech/atlas-harness'

import { EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect, type TestClient } from './client'
import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  hello,
  inMemoryContextFiles,
  releaseServeSpec,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

type BootingProbe = {
  port: Promise<number>
  handle: Promise<ServeHandle>
  lines: string[]
  openGate: () => void
}

const probes: BootingProbe[] = []
const homes: string[] = []

const GATE_TIMEOUT_MS = 5_000

const gate = () => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

const listeningPort = async (lines: string[]): Promise<number> => {
  const deadline = Date.now() + GATE_TIMEOUT_MS
  while (Date.now() < deadline) {
    for (const line of lines) {
      if (!line.includes('serve.listening')) continue
      const parsed = JSON.parse(line) as { port?: unknown }
      if (typeof parsed.port === 'number') return parsed.port
    }
    await Bun.sleep(5)
  }
  throw new Error('the serve never logged that it is listening')
}

const register = (probe: BootingProbe): BootingProbe => {
  probes.push(probe)
  return probe
}

const bootingServe = (args: { gateOpen?: boolean | undefined } = {}): BootingProbe => {
  const workspaceGate = gate()
  const lines: string[] = []
  const handle = startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    write: (line) => lines.push(line),
    compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    ensureWorkspace: async () => {
      await workspaceGate.opened
      return { state: EWorkspaceState.Skipped }
    },
    contextFiles: inMemoryContextFiles(),
  })
  const probe: BootingProbe = {
    port: listeningPort(lines),
    handle,
    lines,
    openGate: workspaceGate.open,
  }
  if (args.gateOpen === true) workspaceGate.open()
  return register(probe)
}

const driveHomeWithArchive = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-handshake-home-'))
  homes.push(home)
  const bootstrap = join(home, 'bootstrap')
  mkdirSync(bootstrap, { recursive: true })
  writeFileSync(join(bootstrap, 'workspace.tar.gz'), 'staged')
  return home
}

const restoredWorkspace = (): RestoredWorkspace => ({
  cwd: '/workspace',
  repository: null,
  trees: [],
})

const bootingDirectServe = (): BootingProbe => {
  const restoreGate = gate()
  const home = driveHomeWithArchive()
  const heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const lines: string[] = []
  const handle = startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    write: (line) => lines.push(line),
    compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    restoreWorkspace: async () => {
      await restoreGate.opened
      return restoredWorkspace()
    },
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
  })
  void handle.finally(() => {
    if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = heldAtlasHome
  })
  return register({
    port: listeningPort(lines),
    handle,
    lines,
    openGate: restoreGate.open,
  })
}

const failingServe = (args: { reason: string }): BootingProbe => {
  const crashGate = gate()
  const lines: string[] = []
  const heldAtlasHome = process.env.ATLAS_HOME
  const home = mkdtempSync(join(tmpdir(), 'atlas-handshake-home-'))
  homes.push(home)
  process.env.ATLAS_HOME = home
  const handle = startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    write: (line) => lines.push(line),
    compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    ensureWorkspace: async () => {
      await crashGate.opened
      throw new Error(args.reason)
    },
    contextFiles: inMemoryContextFiles(),
  })
  const restoreHome = (): void => {
    if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = heldAtlasHome
  }
  void handle.then(restoreHome, restoreHome)
  return register({ port: listeningPort(lines), handle, lines, openGate: crashGate.open })
}

const replyFrom = async (args: { client: TestClient; id: string }): Promise<ServeFrame> =>
  args.client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === args.id)

afterEach(async () => {
  while (probes.length > 0) {
    const probe = probes.pop()
    probe?.openGate()
    const handle = await probe?.handle.catch(() => undefined)
    await handle?.close()
  }
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  await releaseServeSpec()
})

describe('websocket upgrade while the serve is still booting', () => {
  it('accepts the upgrade during boot instead of refusing it, then greets once boot completes', async () => {
    const probe = bootingServe()
    const port = await probe.port

    const client = await connect({ port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))

    const framesBeforeGate = [...client.frames]
    expect(framesBeforeGate.some((frame) => frame.kind === EServeFrame.Ready)).toBe(false)

    probe.openGate()
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await probe.handle
    client.close()
  })

  it('still refuses an upgrade offered without the session token while booting', async () => {
    const probe = bootingServe()
    const port = await probe.port

    await expect(connect({ port, token: 'not-the-token' })).rejects.toThrow('the upgrade was refused')
  })

  it('replays buffered frames in order once boot completes', async () => {
    const probe = bootingServe()
    const port = await probe.port

    const client = await connect({ port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    const sent = [
      { kind: EClientFrame.Request, id: 'held-1', op: EClientRequest.ReadRuntimeCheckpoint, params: {} },
      { kind: EClientFrame.Request, id: 'held-2', op: EClientRequest.ReadRuntimeCheckpoint, params: {} },
      { kind: EClientFrame.Request, id: 'held-3', op: EClientRequest.ReadRuntimeCheckpoint, params: {} },
    ] as const
    for (const frame of sent) client.send(frame)

    expect(client.frames).toHaveLength(0)

    probe.openGate()
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    await replyFrom({ client, id: 'held-1' })
    await replyFrom({ client, id: 'held-2' })
    await replyFrom({ client, id: 'held-3' })

    const replies = client.frames.filter(
      (frame) => frame.kind === EServeFrame.Reply && frame.replyTo.startsWith('held-'),
    )
    expect(replies.map((frame) => (frame.kind === EServeFrame.Reply ? frame.replyTo : ''))).toEqual([
      'held-1',
      'held-2',
      'held-3',
    ])
    client.close()
  })

  it('closes a held socket with an error when the boot fails', async () => {
    const probe = failingServe({ reason: 'spec boot failure' })
    const port = await probe.port

    const client = await connect({ port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await Bun.sleep(20)

    let rejected: string | undefined
    void probe.handle.catch((failure: unknown) => {
      rejected = failure instanceof Error ? failure.message : String(failure)
    })

    probe.openGate()
    const error = await client.waitFor((frame) => frame.kind === EServeFrame.Error)
    expect(error.kind === EServeFrame.Error ? error.message : '').toContain('spec boot failure')
    expect(await client.closed).toBe(1011)
    expect(rejected).toBe('spec boot failure')
  })
})

describe('a workspace apply issued while the serve is still booting', () => {
  it('resolves after materialize completes instead of being refused', async () => {
    const probe = bootingDirectServe()
    const port = await probe.port

    const client = await connect({ port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    client.send({
      kind: EClientFrame.Request,
      id: 'apply-boot',
      op: EClientRequest.ApplyWorkspaceArchive,
      params: {},
    })

    await Bun.sleep(100)
    expect(client.frames.some((frame) => frame.kind === EServeFrame.Reply)).toBe(false)

    probe.openGate()
    const reply = await replyFrom({ client, id: 'apply-boot' })
    expect(reply.kind === EServeFrame.Reply ? reply.ok : false).toBe(true)
    client.close()
  })
})
