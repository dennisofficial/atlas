import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { EAgentStatus, EKilledBy, toThreadId } from '@dltech/atlas-core'

import { EClientFrame, EClientRequest, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import { EWorkspaceState, startServe, type ServeHandle } from '../index'
import type { ServeAgentSteer } from '../serve-app'

import { connect, type TestClient } from './client'
import { fakeServeApp } from './fakes'

const TOKEN = 'session-token'
const threadId = toThreadId('thread-steer')
const CONTROL_PLANE = 'https://api.example.com'

const CHILD = {
  agentId: toThreadId('child-steered'),
  spawnedBy: threadId,
  agentType: 'explore',
  intent: 'map the seam',
  status: EAgentStatus.Running,
  turns: 1,
  toolCalls: 3,
  lastTool: undefined,
  startedAt: '2026-10-02T20:00:00.000Z',
  endedAt: undefined,
}

const homes: string[] = []
const running: ServeHandle[] = []
let heldAtlasHome: string | undefined

afterEach(async () => {
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  while (running.length > 0) await running.pop()?.close()
  for (const home of homes.splice(0, homes.length)) rmSync(home, { recursive: true, force: true })
})

const start = async (
  agents: ServeAgentSteer | undefined,
): Promise<{ client: TestClient }> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-steer-'))
  homes.push(home)
  heldAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => (agents === undefined ? app : { ...app, agents }),
    ensureWorkspace: async () => ({ state: EWorkspaceState.Skipped }),
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  running.push(handle)

  const client = await connect({ port: handle.port, token: TOKEN })
  client.send({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 })
  await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
  return { client }
}

const steer = async (args: {
  client: TestClient
  id: string
  op: EClientRequest
  params: unknown
}): Promise<ServeFrame> => {
  args.client.send({ kind: EClientFrame.Request, id: args.id, op: args.op, params: args.params })
  return await args.client.waitFor(
    (frame) => frame.kind === EServeFrame.Reply && frame.replyTo === args.id,
  )
}

const params = { threadId, agentId: CHILD.agentId }

describe('the operator agent-steer ops', () => {
  it('forwards a say to the sandbox’s own registry and answers with its outcome', async () => {
    const seen: { threadId: unknown; agentId: unknown; text: unknown }[] = []
    const { client } = await start({
      say: async (said) => {
        seen.push({ threadId: said.threadId, agentId: said.agentId, text: said.text })
        return { ok: true, snapshot: CHILD }
      },
      resume: async () => ({ ok: true, snapshot: CHILD }),
      stop: async () => ({ ok: true, snapshot: CHILD }),
    })

    const reply = await steer({
      client,
      id: 'say-1',
      op: EClientRequest.SayToAgent,
      params: { ...params, text: 'keep the commits conventional' },
    })

    expect(reply).toMatchObject({ ok: true, data: { ok: true, snapshot: { intent: 'map the seam' } } })
    expect(seen).toEqual([
      { threadId, agentId: CHILD.agentId, text: 'keep the commits conventional' },
    ])
  })

  it('forwards a resume with no message attached', async () => {
    const seen: { threadId: unknown; agentId: unknown }[] = []
    const { client } = await start({
      say: async () => ({ ok: true, snapshot: CHILD }),
      resume: async (asked) => {
        seen.push({ threadId: asked.threadId, agentId: asked.agentId })
        return { ok: true, snapshot: CHILD }
      },
      stop: async () => ({ ok: true, snapshot: CHILD }),
    })

    const reply = await steer({ client, id: 'resume-1', op: EClientRequest.ResumeAgent, params })

    expect(reply).toMatchObject({ ok: true, data: { ok: true } })
    expect(seen).toEqual([params])
  })

  it('stops the agent as the operator, never as the model', async () => {
    const seen: { by: unknown }[] = []
    const { client } = await start({
      say: async () => ({ ok: true, snapshot: CHILD }),
      resume: async () => ({ ok: true, snapshot: CHILD }),
      stop: async (asked) => {
        seen.push({ by: asked.by })
        return { ok: true, snapshot: { ...CHILD, status: EAgentStatus.Stopped, killedBy: asked.by } }
      },
    })

    const reply = await steer({ client, id: 'stop-1', op: EClientRequest.StopAgent, params })

    expect(reply).toMatchObject({
      ok: true,
      data: { ok: true, snapshot: { status: EAgentStatus.Stopped, killedBy: EKilledBy.User } },
    })
    expect(seen).toEqual([{ by: EKilledBy.User }])
  })

  it('hands the registry’s refusal through as a refused outcome, not a protocol error', async () => {
    const { client } = await start({
      say: async () => ({ ok: true, snapshot: CHILD }),
      resume: async () => ({
        ok: false,
        reason: 'agent child-steered is finished, so a queued resume is dropped',
      }),
      stop: async () => ({ ok: true, snapshot: CHILD }),
    })

    const reply = await steer({ client, id: 'resume-2', op: EClientRequest.ResumeAgent, params })

    expect(reply).toMatchObject({
      ok: true,
      data: { ok: false, reason: 'agent child-steered is finished, so a queued resume is dropped' },
    })
  })

  it('refuses malformed params before the registry is touched', async () => {
    let touched = false
    const { client } = await start({
      say: async () => {
        touched = true
        return { ok: true, snapshot: CHILD }
      },
      resume: async () => ({ ok: true, snapshot: CHILD }),
      stop: async () => ({ ok: true, snapshot: CHILD }),
    })

    const reply = await steer({
      client,
      id: 'say-2',
      op: EClientRequest.SayToAgent,
      params: { threadId },
    })

    expect(reply).toMatchObject({ ok: false })
    expect(touched).toBe(false)
  })

  it('refuses the ops on a serve composed without an agent registry', async () => {
    const { client } = await start(undefined)

    const reply = await steer({ client, id: 'stop-2', op: EClientRequest.StopAgent, params })

    expect(reply).toMatchObject({ ok: false, data: { message: 'this serve holds no agents to steer' } })
  })
})
