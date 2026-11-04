import { describe, expect, it } from 'bun:test'
import { EGateVerdict, type GateClock, runHealthGate } from '../scripts/deployment-health-gate'

const config = {
  token: 'vercel-token',
  teamId: 'team_1',
  projectId: 'prj_1',
  sha: 'abc123',
  bypassSecret: 'bypass',
}

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

function fakeVercel({
  states,
  health,
}: {
  states: (string | undefined)[]
  health: (number | Error)[]
}) {
  const listed: string[] = []
  const probed: RequestInit[] = []
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    if (url.startsWith('https://api.vercel.com/v6/deployments')) {
      listed.push(url)
      const state = states.length > 1 ? states.shift() : states[0]
      const deployments = state ? [{ url: 'atlas-x.vercel.app', state }] : []
      return Response.json({ deployments })
    }
    probed.push(init)
    const answer = health.length > 1 ? health.shift() : health[0]
    if (answer === undefined) throw new Error('no health answer scripted')
    if (answer instanceof Error) throw answer
    return new Response(answer === 200 ? '{"status":"ok"}' : 'FUNCTION_INVOCATION_FAILED', {
      status: answer,
    })
  }
  return { fetcher, listed, probed }
}

describe('runHealthGate', () => {
  it('passes a ready deployment whose health answers 200, sending the bypass header', async () => {
    const vercel = fakeVercel({ states: ['READY'], health: [200] })

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Healthy)
    expect(vercel.listed[0]).toContain('meta-githubCommitSha=abc123')
    expect(vercel.listed[0]).toContain('target=production')
    expect(vercel.probed[0]?.headers).toEqual({ 'x-vercel-protection-bypass': 'bypass' })
  })

  it('waits for the deployment to appear and finish building before probing', async () => {
    const vercel = fakeVercel({ states: [undefined, 'BUILDING', 'READY'], health: [200] })
    const clock = fakeClock()

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock })

    expect(result.verdict).toBe(EGateVerdict.Healthy)
    expect(vercel.listed).toHaveLength(3)
  })

  it('fails a deployment that crashes on every probe', async () => {
    const vercel = fakeVercel({ states: ['READY'], health: [500] })

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Unhealthy)
    expect(result.detail).toContain('FUNCTION_INVOCATION_FAILED')
    expect(vercel.probed).toHaveLength(6)
  })

  it('retries through a slow cold start', async () => {
    const vercel = fakeVercel({
      states: ['READY'],
      health: [new Error('The operation timed out.'), 503, 200],
    })

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Healthy)
    expect(vercel.probed).toHaveLength(3)
  })

  it('passes without probing when vercel canceled the build as unaffected', async () => {
    const vercel = fakeVercel({ states: ['CANCELED'], health: [500] })

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.NotDeployed)
    expect(vercel.probed).toHaveLength(0)
  })

  it('fails a deployment whose build errored', async () => {
    const vercel = fakeVercel({ states: ['ERROR'], health: [200] })

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Unhealthy)
    expect(vercel.probed).toHaveLength(0)
  })

  it('fails when no deployment settles before the deadline', async () => {
    const vercel = fakeVercel({ states: ['BUILDING'], health: [200] })

    const result = await runHealthGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EGateVerdict.Unhealthy)
    expect(result.detail).toContain('no production deployment of abc123')
  })
})
