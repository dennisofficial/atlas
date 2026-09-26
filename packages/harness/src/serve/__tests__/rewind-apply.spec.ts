import { afterEach, describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '@dltech/atlas-core'

import {
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  type ServeFrame,
} from '../../cloud/channel-wire'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import {
  EWorkspaceState,
  startServe,
  type ServeHandle,
  type WorkspaceFiles,
} from '../index'
import type { RunTurn } from './fakes'

import { connect, type TestClient } from './client'
import { fakeRewindTarget, fakeServeApp, type FakeRewindTarget } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-serve')
const CONTROL_PLANE = 'https://api.example.com'

const running: ServeHandle[] = []

const inMemoryContextFiles = (): WorkspaceFiles => {
  const stored = new Map<string, string>()
  return {
    exists: async (path) => stored.has(path),
    read: async (path) => {
      const text = stored.get(path)
      if (text === undefined) throw new Error(`no such file: ${path}`)
      return text
    },
    write: async ({ path, text }) => {
      stored.set(path, text)
    },
    writeBytes: async ({ path, bytes }) => {
      stored.set(path, bytes.toString('utf8'))
    },
    ensureDirectory: async () => undefined,
    empty: async () => undefined,
  }
}

type Started = {
  client: TestClient
  target: FakeRewindTarget | null
  lines: string[]
}

const start = async (args: {
  withRewind?: boolean
  runTurn?: RunTurn | undefined
}): Promise<Started> => {
  const target = args.withRewind === false ? null : fakeRewindTarget()
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    ...(args.runTurn === undefined ? {} : { runTurn: args.runTurn }),
    ...(target === null ? {} : { rewindTarget: target }),
  })

  const lines: string[] = []
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    write: (line) => lines.push(line),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    compose: async () => app,
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    contextFiles: inMemoryContextFiles(),
  })
  running.push(handle)

  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({
    kind: EClientFrame.Hello,
    threadId,
    channelCursor: null,
    lastEventSeq: 0,
    protocol: CHANNEL_PROTOCOL_VERSION,
  })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

  return { client, target, lines }
}

let requests = 0

const requestRewind = async (client: TestClient, params: unknown): Promise<ServeFrame> => {
  requests += 1
  const id = `req-${requests}`
  client.send({ kind: EClientFrame.Request, id, op: EClientRequest.Rewind, params })
  return client.waitFor((frame) => frame.kind === EServeFrame.Reply && frame.replyTo === id)
}

const settleIn = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  for (const handle of running.splice(0, running.length)) await handle.close()
})

describe('the rewind request over the session socket', () => {
  it('removes the cut creations from the sandbox’s registries and answers how many applied', async () => {
    const { client, target } = await start({})

    const reply = await requestRewind(client, {
      threadId,
      cuts: [
        { kind: 'shell', shellId: 'bash_1', command: 'npm test' },
        { kind: 'service', serviceId: 'svc_1', command: 'npm run dev' },
        { kind: 'agent', agentId: 'thr-child', agentType: 'builder', intent: 'fix the test' },
      ],
    })

    expect(reply).toMatchObject({ ok: true, data: { applied: 3 } })
    expect(target?.removed.shells).toEqual(['bash_1'])
    expect(target?.removed.services).toEqual(['svc_1'])
    expect(target?.removed.agents).toEqual([toThreadId('thr-child')])
  })

  it('interrupts a turn in flight, so its next step reads the truncated log', async () => {
    let observedAbort: AbortSignal | undefined
    let release: (outcome: TurnOutcome) => void = () => undefined
    const turn = new Promise<TurnOutcome>((resolve) => {
      release = resolve
    })
    const runTurn: RunTurn = ({ signal }) => {
      observedAbort = signal
      return turn
    }
    const { client } = await start({ runTurn })

    client.send({ kind: EClientFrame.Run })
    await settleIn(50)
    if (observedAbort === undefined) throw new Error('the turn never observed its signal')
    const turnSignal: AbortSignal = observedAbort
    expect(turnSignal.aborted).toBe(false)

    const replyPromise = requestRewind(client, { threadId, cuts: [] })
    await settleIn(50)
    expect(turnSignal.aborted).toBe(true)
    release({ status: ETurnStatus.Interrupted, runId: toRunId('run-1'), committed: true })

    const reply = await replyPromise
    expect(reply).toMatchObject({ ok: true, data: { applied: 0 } })
  })

  it('refuses a rewind naming another thread', async () => {
    const { client, target } = await start({})

    const reply = await requestRewind(client, {
      threadId: toThreadId('thread-elsewhere'),
      cuts: [{ kind: 'shell', shellId: 'bash_1' }],
    })

    expect(reply).toMatchObject({ ok: false })
    expect(target?.removed.shells).toEqual([])
  })

  it('refuses a body that does not parse, and removes nothing', async () => {
    const { client, target } = await start({})

    const reply = await requestRewind(client, { threadId, cuts: [{ kind: 'shell' }] })

    expect(reply).toMatchObject({ ok: false })
    expect(target?.removed.shells).toEqual([])
  })

  it('answers a legible refusal when the session has no registries behind it', async () => {
    const { client } = await start({ withRewind: false })

    const reply = await requestRewind(client, { threadId, cuts: [] })

    expect(reply).toMatchObject({ ok: false })
  })
})
