import { describe, expect, it } from 'bun:test'
import {
  EDeployJudgement,
  EGateVerdict,
  type GateClock,
  judgeDeploy,
  runDeployGate,
} from '../scripts/render-deploy-gate'

const config = { token: 'render-token', serviceId: 'srv_1', sha: 'abc123' }

function fakeClock(): GateClock & { slept: number[] } {
  let now = 0
  const slept: number[] = []
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms)
      now += ms
    },
  }
}

type ScriptedDeploy = { id: string; status: string; commitId?: string }

function entry({ id, status, commitId = 'abc123' }: ScriptedDeploy): unknown {
  return { deploy: { id, status, commit: { id: commitId } } }
}

function fakeRender({
  lists,
  health,
}: {
  lists: (ScriptedDeploy[] | undefined)[]
  health: (number | Error)[]
}) {
  const listed: { url: string; init: RequestInit }[] = []
  const probed: RequestInit[] = []
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.startsWith('https://api.render.com/v1/services/srv_1/deploys')) {
      listed.push({ url, init })
      const next = lists.length > 1 ? lists.shift() : lists[0]
      return Response.json((next ?? []).map(entry))
    }
    probed.push(init)
    const answer = health.length > 1 ? health.shift() : health[0]
    if (answer === undefined) throw new Error('no health answer scripted')
    if (answer instanceof Error) throw answer
    return new Response(answer === 200 ? '{"status":"ok"}' : 'starting', { status: answer })
  }
  return { fetcher, listed, probed }
}

describe('judgeDeploy', () => {
  it('reads the list newest first, so a live deploy before ours supersedes it', () => {
    const judgement = judgeDeploy({
      deploys: [
        { id: 'dep_2', status: 'live', commitId: 'def456' },
        { id: 'dep_1', status: 'deactivated', commitId: 'abc123' },
      ],
      sha: 'abc123',
    })

    expect(judgement.verdict).toBe(EDeployJudgement.Superseded)
    expect(judgement.detail).toContain('def456')
  })

  it('does not treat a live deploy listed after ours as superseding it', () => {
    const judgement = judgeDeploy({
      deploys: [
        { id: 'dep_1', status: 'build_in_progress', commitId: 'abc123' },
        { id: 'dep_0', status: 'live', commitId: 'def456' },
      ],
      sha: 'abc123',
    })

    expect(judgement.verdict).toBe(EDeployJudgement.Waiting)
  })
})

describe('runDeployGate', () => {
  it('passes the deploy of this commit once it is live and healthz answers 200', async () => {
    const render = fakeRender({ lists: [[{ id: 'dep_1', status: 'live' }]], health: [200] })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Live)
    expect(render.listed[0]?.url).toContain('/services/srv_1/deploys?limit=20')
    expect(render.listed[0]?.init.headers).toEqual({ authorization: 'Bearer render-token' })
    expect(render.probed).toHaveLength(1)
  })

  it('waits out a queued deploy until it starts building and goes live', async () => {
    const render = fakeRender({
      lists: [
        [{ id: 'dep_1', status: 'queued' }],
        [{ id: 'dep_1', status: 'build_in_progress' }],
        [{ id: 'dep_1', status: 'live' }],
      ],
      health: [200],
    })
    const clock = fakeClock()

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock })

    expect(result.verdict).toBe(EGateVerdict.Live)
    expect(render.listed).toHaveLength(3)
    expect(clock.slept).toHaveLength(2)
  })

  it('waits through the deploy steps before probing', async () => {
    const render = fakeRender({
      lists: [
        [],
        [{ id: 'dep_1', status: 'created' }],
        [{ id: 'dep_1', status: 'build_in_progress' }],
        [{ id: 'dep_1', status: 'pre_deploy_in_progress' }],
        [{ id: 'dep_1', status: 'update_in_progress' }],
        [{ id: 'dep_1', status: 'live' }],
      ],
      health: [200],
    })
    const clock = fakeClock()

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock })

    expect(result.verdict).toBe(EGateVerdict.Live)
    expect(render.listed).toHaveLength(6)
    expect(clock.slept).toHaveLength(5)
  })

  it('passes a superseded deploy once healthz answers 200', async () => {
    const render = fakeRender({
      lists: [
        [
          { id: 'dep_2', status: 'live', commitId: 'def456' },
          { id: 'dep_1', status: 'deactivated' },
        ],
      ],
      health: [200],
    })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Superseded)
    expect(result.detail).toContain('def456')
    expect(render.probed).toHaveLength(1)
  })

  it('fails a superseded deploy whose healthz never answers 200', async () => {
    const render = fakeRender({
      lists: [
        [
          { id: 'dep_2', status: 'live', commitId: 'def456' },
          { id: 'dep_1', status: 'deactivated' },
        ],
      ],
      health: [500],
    })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Unhealthy)
    expect(render.probed).toHaveLength(6)
  })

  it('passes a canceled deploy only once a newer commit is live', async () => {
    const render = fakeRender({
      lists: [
        [{ id: 'dep_1', status: 'canceled' }],
        [
          { id: 'dep_2', status: 'build_in_progress', commitId: 'def456' },
          { id: 'dep_1', status: 'canceled' },
        ],
        [
          { id: 'dep_2', status: 'live', commitId: 'def456' },
          { id: 'dep_1', status: 'canceled' },
        ],
      ],
      health: [200],
    })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Superseded)
    expect(render.listed).toHaveLength(3)
    expect(render.probed).toHaveLength(1)
  })

  it('fails a deploy that ended build_failed, pre_deploy_failed or update_failed', async () => {
    for (const status of ['build_failed', 'pre_deploy_failed', 'update_failed']) {
      const render = fakeRender({ lists: [[{ id: 'dep_1', status }]], health: [200] })

      const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

      expect(result.verdict).toBe(EGateVerdict.Failed)
      expect(result.detail).toContain(status)
      expect(render.probed).toHaveLength(0)
    }
  })

  it('fails a status it cannot read instead of waiting out the timeout', async () => {
    const render = fakeRender({ lists: [[{ id: 'dep_1', status: 'paused' }]], health: [200] })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Failed)
    expect(result.detail).toContain('paused')
    expect(render.listed).toHaveLength(1)
  })

  it('fails when this commit never gets a deploy', async () => {
    const render = fakeRender({
      lists: [[{ id: 'dep_1', status: 'live', commitId: 'def456' }]],
      health: [200],
    })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.TimedOut)
    expect(result.detail).toContain('no deploy of abc123')
  })

  it('fails a live deploy that never answers healthz 200', async () => {
    const render = fakeRender({ lists: [[{ id: 'dep_1', status: 'live' }]], health: [500] })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Unhealthy)
    expect(result.detail).toContain('starting')
    expect(render.probed).toHaveLength(6)
  })

  it('retries through a slow boot of a live deploy', async () => {
    const render = fakeRender({
      lists: [[{ id: 'dep_1', status: 'live' }]],
      health: [new Error('The operation timed out.'), 503, 200],
    })

    const result = await runDeployGate({ config, fetcher: render.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Live)
    expect(render.probed).toHaveLength(3)
  })
})
