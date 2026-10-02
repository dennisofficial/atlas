import { afterEach, describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EKilledBy, toRunId } from '@dltech/atlas-core'
import { EClientFrame, EServeFrame, ETurnStatus } from '@dltech/atlas-harness'

import { startServe } from '../index'
import { DRAIN_PATH } from '../session-server'
import { connect } from './client'
import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  gate,
  hello,
  inMemoryContextFiles,
  releaseServeSpec,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

const scratchHomes: string[] = []
let heldAtlasHome: string | undefined

afterEach(() => {
  releaseServeSpec()
  if (heldAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = heldAtlasHome
  heldAtlasHome = undefined
  for (const home of scratchHomes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const boot = async (over: { holdTurn?: Promise<void> } = {}) => {
  const order: string[] = []
  const endings: EKilledBy[] = []
  let exitCode: number | undefined
  const home = mkdtempSync(join(tmpdir(), 'atlas-serve-drain-spec-'))
  scratchHomes.push(home)
  heldAtlasHome ??= process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const app = {
    ...fakeServeApp({
      threadId,
      root: '/workspace',
      runTurn: async ({ pause }) => {
        order.push('turn-started')
        await over.holdTurn
        while (pause?.paused !== true) await Bun.sleep(1)
        return { status: ETurnStatus.RelocationPaused, runId: toRunId('run-1') }
      },
    }),
    endProcesses: async ({ killedBy }: { killedBy: EKilledBy }) => {
      endings.push(killedBy)
      order.push('endings')
    },
  }
  const exited = gate()
  const handle = await startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    compose: async () => app,
    write: () => undefined,
    exit: (code) => { exitCode = code; order.push('exit'); exited.open() },
    contextFiles: inMemoryContextFiles(),
    ensureWorkspace: async () => ({ state: 'skipped' }) as never,
    fetchFn: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  })
  const url = `http://127.0.0.1:${handle.port}${DRAIN_PATH}`
  const post = (init: { token?: string; body?: unknown }) =>
    fetch(url, {
      method: 'POST',
      headers: {
        ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
        'content-type': 'application/json',
      },
      body: JSON.stringify(init.body ?? { reason: 'protocol drift' }),
    })
  return { app, handle, order, endings, post, exited, exitCode: () => exitCode }
}

describe('POST /v1/drain', () => {
  it('refuses a request without the session token', async () => {
    const test = await boot()

    expect((await test.post({})).status).toBe(401)
    expect((await test.post({ token: 'wrong' })).status).toBe(401)
    expect(test.endings).toEqual([])
  })

  it('refuses a request without a reason and drains nothing', async () => {
    const test = await boot()

    expect((await test.post({ token: TOKEN, body: {} })).status).toBe(400)
    expect(test.endings).toEqual([])
    expect(test.exitCode()).toBeUndefined()
  })

  it('refuses any method but POST', async () => {
    const test = await boot()

    const response = await fetch(`http://127.0.0.1:${test.handle.port}${DRAIN_PATH}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(405)
  })

  it('answers an idle serve, ends its processes as a rotation, and only then exits', async () => {
    const test = await boot()

    const response = await test.post({ token: TOKEN })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, paused: false })
    expect(test.endings).toEqual([EKilledBy.Rotation])
    expect(test.exitCode()).toBeUndefined()
    await test.exited.opened
    expect(test.exitCode()).toBe(0)
  })

  it('waits for a running turn to pause at its seam before ending processes, and reports it paused', async () => {
    const test = await boot()
    const client = await connect({ port: test.handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(20)
    expect(test.order).toContain('turn-started')

    const response = await test.post({ token: TOKEN })

    expect(await response.json()).toEqual({ ok: true, paused: true })
    expect(test.order.indexOf('endings')).toBeGreaterThan(test.order.indexOf('turn-started'))
    await test.exited.opened
  })

  it('serves a second request that lands mid-drain the same result and ends processes once', async () => {
    const holding = gate()
    const test = await boot({ holdTurn: holding.opened })
    const client = await connect({ port: test.handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(20)

    const first = test.post({ token: TOKEN })
    await Bun.sleep(10)
    const second = test.post({ token: TOKEN })
    await Bun.sleep(10)
    expect(test.endings).toEqual([])
    holding.open()

    const [one, two] = await Promise.all([first, second])
    expect(await one.json()).toEqual({ ok: true, paused: true })
    expect(await two.json()).toEqual({ ok: true, paused: true })
    expect(test.endings).toHaveLength(1)
    await test.exited.opened
  })
})
