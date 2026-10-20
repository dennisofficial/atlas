import { afterEach, describe, expect, it } from 'bun:test'

import { ATLAS_HOME_ENV, EHarnessPlacement, ERunner, toRunId, toThreadId } from '@dltech/atlas-core'

import {
  EClientFrame,
  EServeFrame,
  ETurnStatus,
  placementRecordOf,
  POD_NAME_ENV,
  readMetaSync,
  sessionDirectory,
  threadMetaFile,
  threadMetaSchema,
} from '@dltech/atlas-harness'
import {
  EServeEnv,
  EServeEvent,
  EWorkspaceState,
  EWorkspaceStep,
  type EnsureWorkspace,
} from '../index'

import { connect } from './client'
import { fakeServeApp } from './fakes'
import {
  CONTROL_PLANE,
  hello,
  releaseServeSpec,
  start,
  startWithDriveSpec,
  threadId,
  TOKEN,
} from './serve-spec-fixture'

afterEach(releaseServeSpec)

describe('startServe', () => {
  it('boots from the variables the sandbox was created with, and logs none of them', async () => {
    const { handle, lines } = await start({
      env: {
        [EServeEnv.Token]: TOKEN,
        [EServeEnv.Port]: '0',
        [EServeEnv.ThreadId]: 'thread-serve',
        [EServeEnv.CloudUrl]: CONTROL_PLANE,
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    expect(lines.some((line) => line.includes(EServeEvent.Started))).toBe(true)
    expect(lines.some((line) => line.includes(TOKEN))).toBe(false)
  })

  it('closes and exits once the conversation has gone quiet past the idle TTL', async () => {
    const exits: number[] = []
    const { app, lines } = await start({
      idleMinutes: 0.001,
      idleTickMs: 5,
      exit: (code) => exits.push(code),
      stopSandbox: async () => undefined,
      env: {
        [EServeEnv.Token]: TOKEN,
        [EServeEnv.Port]: '0',
        [EServeEnv.ThreadId]: 'thread-serve',
        [EServeEnv.CloudUrl]: CONTROL_PLANE,
        ATLAS_SANDBOX_SESSION_ID: 'session-1',
      },
    })

    await Bun.sleep(200)

    expect(app.closed()).toBe(true)
    expect(exits).toEqual([0])
    expect(lines.some((line) => line.includes(EServeEvent.IdleStop))).toBe(true)
  })

  it('never parks itself mid-turn', async () => {
    let release = (): void => undefined
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const exits: number[] = []
    const { handle, app } = await start({
      idleMinutes: 0.001,
      idleTickMs: 5,
      exit: (code) => exits.push(code),
      runTurn: async () => {
        await turn
        return { status: ETurnStatus.Completed, runId: toRunId('run-1') }
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    await Bun.sleep(100)

    expect(app.closed()).toBe(false)
    expect(exits).toEqual([])

    release()
    await client.waitFor((frame) => frame.kind === EServeFrame.TurnEnded)
  })

  it('reports a workspace it could not materialize, and refuses to work in an empty tree', async () => {
    const { handle, lines } = await start({
      workspace: {
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      },
    })

    const health = await fetch(`http://127.0.0.1:${handle.port}/v1/health`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(await health.json()).toMatchObject({
      ok: false,
      workspace: { state: EWorkspaceState.Failed, step: EWorkspaceStep.Clone },
    })
    expect(lines.some((line) => line.includes(EServeEvent.WorkspaceFailed))).toBe(true)

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    client.send({ kind: EClientFrame.Send, sendId: 'send-go' as never, text: 'go' })
    const refusal = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(refusal).toMatchObject({ kind: EServeFrame.Error })
    expect(JSON.stringify(refusal)).toContain('fatal: repository not found')
  })

  it('announces a failed workspace on hello, before anyone speaks', async () => {
    const { handle } = await start({
      workspace: {
        state: EWorkspaceState.Failed,
        step: EWorkspaceStep.Clone,
        reason: 'fatal: repository not found',
      },
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    const announced = await client.waitFor((frame) => frame.kind === EServeFrame.Error)

    expect(JSON.stringify(announced)).toContain('fatal: repository not found')
  })

  it('logs the workspace it found already materialized', async () => {
    const { lines } = await start({ workspace: { state: EWorkspaceState.Present } })

    expect(
      lines.some(
        (line) =>
          line.includes(EServeEvent.WorkspaceReady) && line.includes(EWorkspaceState.Present),
      ),
    ).toBe(true)
  })

  it('times the workspace materialization in its boot log', async () => {
    const ensureWorkspace: EnsureWorkspace = async () => {
      await Bun.sleep(30)
      return { state: EWorkspaceState.Skipped }
    }
    const { lines } = await start({ ensureWorkspace })

    const ready = lines.find((line) => line.includes(EServeEvent.WorkspaceReady))
    const ms: unknown = JSON.parse(ready ?? '{}').ms
    expect(typeof ms).toBe('number')
    expect(ms).toBeGreaterThanOrEqual(20)
  })

  it('times the context materialization in its boot log', async () => {
    const { lines } = await start({})

    const context = lines.find(
      (line) =>
        line.includes(EServeEvent.ContextReady) || line.includes(EServeEvent.ContextFailed),
    )
    expect(context).toBeDefined()
    expect(JSON.parse(context ?? '{}').ms).toEqual(expect.any(Number))
  })

  it('stamps the whole boot on the started line', async () => {
    const { lines } = await start({})

    const started = lines.find((line) => line.includes(EServeEvent.Started))
    expect(JSON.parse(started ?? '{}').ms).toEqual(expect.any(Number))
  })

  it('stamps the born cloud placement into the thread meta the store infers placement from', async () => {
    await start({})

    const home = process.env[ATLAS_HOME_ENV] ?? ''
    const file = threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    const meta = readMetaSync({ file, schema: threadMetaSchema })

    expect(meta).toBeDefined()
    expect(meta?.executionLocation).toBe('cloud')
    expect(placementRecordOf(meta!)?.placement).toEqual({ harness: EHarnessPlacement.Cloud })
  })

  it('stamps the local runner into the born thread meta when it boots in a pod', async () => {
    await start({
      env: {
        [EServeEnv.Token]: TOKEN,
        [EServeEnv.Port]: '0',
        [EServeEnv.ThreadId]: threadId,
        [EServeEnv.CloudUrl]: CONTROL_PLANE,
        [POD_NAME_ENV]: 'atlas-pod-spec',
      },
    })

    const home = process.env[ATLAS_HOME_ENV] ?? ''
    const file = threadMetaFile({ sessionDir: sessionDirectory({ home, sessionId: threadId }), threadId })
    expect(readMetaSync({ file, schema: threadMetaSchema })?.runner).toBe(ERunner.Local)
  })

  it("adopts the thread's transferred children on boot, before anyone connects", async () => {
    const { app } = await start({
      adoptChildren: async () => [toThreadId('thread-child')],
    })

    expect(app.adoptions()).toEqual([threadId])
  })

  it('serves the socket even when child adoption fails, and only logs it', async () => {
    const { handle, lines } = await start({
      adoptChildren: () => Promise.reject(new Error('control plane unreachable')),
    })

    const client = await connect({ port: handle.port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)

    expect(
      lines.some(
        (line) =>
          line.includes(EServeEvent.ChildAdoptionFailed) &&
          line.includes('control plane unreachable'),
      ),
    ).toBe(true)
  })

  it('resolves a project the bootstrap names from the control plane and hands the materializer its branch and extras', async () => {
    const seen: Array<{ cwd: string; spec: Awaited<ReturnType<Parameters<EnsureWorkspace>[0]['fetchSpec']>> }> = []
    const requested: Array<{ url: string; authorization: string | null }> = []
    const ensureWorkspace: EnsureWorkspace = async ({ cwd, fetchSpec }) => {
      seen.push({ cwd, spec: await fetchSpec() })
      return { state: EWorkspaceState.Skipped }
    }

    await startWithDriveSpec({
      spec: { projectId: 'proj-boot' },
      ensureWorkspace,
      fetchFn: (async (input: unknown, init?: RequestInit) => {
        requested.push({
          url: String(input),
          authorization: (init?.headers as Record<string, string>).authorization ?? null,
        })
        return Response.json({
          projectId: 'proj-boot',
          repo: 'octocat/Hello-World',
          baseBranch: 'test',
          additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
          githubToken: null,
        })
      }) as typeof fetch,
      compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]?.cwd).toBe('/atlas/workspaces/Hello-World')
    expect(seen[0]?.spec).toMatchObject({
      remoteUrl: 'https://github.com/octocat/Hello-World.git',
      baseBranch: 'test',
      additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }],
    })
    expect(requested[0]).toEqual({
      url: `${CONTROL_PLANE}/v1/projects/proj-boot/workspace`,
      authorization: `Bearer ${TOKEN}`,
    })
  })
})
