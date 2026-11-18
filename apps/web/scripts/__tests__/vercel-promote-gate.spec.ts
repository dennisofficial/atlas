import { describe, expect, it } from 'bun:test'
import {
  EWebGateVerdict,
  EWebJudgement,
  type GateClock,
  judgeWebDeploy,
  runWebGate,
  type WebDeploy,
} from '../vercel-promote-gate'

const config = { token: 'vercel-token', teamId: 'team_1', project: 'web', sha: 'abc123' }

function fakeClock(): GateClock {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
  }
}

type ScriptedDeploy = {
  uid: string
  readyState: string
  readySubstate?: string
  sha?: string
  errorMessage?: string
}

const listed = ({
  uid,
  readyState,
  readySubstate,
  sha = 'abc123',
  errorMessage,
}: ScriptedDeploy) => ({
  uid,
  projectId: 'prj_web',
  readyState,
  readySubstate,
  errorMessage,
  meta: { githubCommitSha: sha },
})

function fakeVercel({ lists }: { lists: ScriptedDeploy[][] }) {
  const promotions: string[] = []
  const listUrls: string[] = []
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    if (init.method === 'POST') {
      promotions.push(url)
      return new Response(null, { status: 201 })
    }
    listUrls.push(url)
    const next = lists.length > 1 ? lists.shift() : lists[0]
    return Response.json({ deployments: (next ?? []).map(listed) })
  }
  return { fetcher, promotions, listUrls }
}

const deploy = (overrides: Partial<WebDeploy>): WebDeploy => ({
  id: 'dpl_1',
  projectId: 'prj_web',
  state: 'READY',
  substate: 'STAGED',
  sha: 'abc123',
  errorMessage: undefined,
  ...overrides,
})

describe('judgeWebDeploy', () => {
  it('promotes a staged build of the commit', () => {
    const judgement = judgeWebDeploy({ deploys: [deploy({})], sha: 'abc123' })

    expect(judgement.verdict).toBe(EWebJudgement.Promotable)
    expect(judgement.deploy?.id).toBe('dpl_1')
  })

  it('leaves a build that auto-assign already put on the domains alone', () => {
    const judgement = judgeWebDeploy({ deploys: [deploy({ substate: 'PROMOTED' })], sha: 'abc123' })

    expect(judgement.verdict).toBe(EWebJudgement.Live)
  })

  it('never rolls production back past a newer build that is already serving', () => {
    const judgement = judgeWebDeploy({
      deploys: [deploy({ id: 'dpl_2', sha: 'def456', substate: 'PROMOTED' }), deploy({})],
      sha: 'abc123',
    })

    expect(judgement.verdict).toBe(EWebJudgement.Superseded)
    expect(judgement.detail).toContain('def456')
  })

  it('ignores a serving build listed after ours, since the list is newest first', () => {
    const judgement = judgeWebDeploy({
      deploys: [deploy({}), deploy({ id: 'dpl_0', sha: 'def456', substate: 'PROMOTED' })],
      sha: 'abc123',
    })

    expect(judgement.verdict).toBe(EWebJudgement.Promotable)
  })

  it('treats a canceled build as nothing to promote', () => {
    const judgement = judgeWebDeploy({
      deploys: [deploy({ state: 'CANCELED', errorMessage: 'the project was not affected' })],
      sha: 'abc123',
    })

    expect(judgement.verdict).toBe(EWebJudgement.Skipped)
  })

  it('fails on a build error', () => {
    const judgement = judgeWebDeploy({ deploys: [deploy({ state: 'ERROR' })], sha: 'abc123' })

    expect(judgement.verdict).toBe(EWebJudgement.Failed)
  })

  it('waits while the commit has no build or is still building', () => {
    expect(judgeWebDeploy({ deploys: [], sha: 'abc123' }).verdict).toBe(EWebJudgement.Waiting)
    expect(
      judgeWebDeploy({ deploys: [deploy({ state: 'BUILDING' })], sha: 'abc123' }).verdict,
    ).toBe(EWebJudgement.Waiting)
  })
})

describe('runWebGate', () => {
  it('waits for the build, promotes it once, and settles when it serves', async () => {
    const vercel = fakeVercel({
      lists: [
        [{ uid: 'dpl_1', readyState: 'BUILDING' }],
        [{ uid: 'dpl_1', readyState: 'READY', readySubstate: 'STAGED' }],
        [{ uid: 'dpl_1', readyState: 'READY', readySubstate: 'STAGED' }],
        [{ uid: 'dpl_1', readyState: 'READY', readySubstate: 'PROMOTED' }],
      ],
    })

    const result = await runWebGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EWebGateVerdict.Live)
    expect(vercel.promotions).toEqual([
      'https://api.vercel.com/v10/projects/prj_web/promote/dpl_1?teamId=team_1',
    ])
    expect(vercel.listUrls[0]).toContain('projectId=web')
    expect(vercel.listUrls[0]).toContain('target=production')
  })

  it('reports a build error without promoting', async () => {
    const vercel = fakeVercel({ lists: [[{ uid: 'dpl_1', readyState: 'ERROR' }]] })

    const result = await runWebGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EWebGateVerdict.Failed)
    expect(vercel.promotions).toEqual([])
  })

  it('times out when the commit never builds', async () => {
    const vercel = fakeVercel({ lists: [[]] })

    const result = await runWebGate({ config, fetcher: vercel.fetcher, clock: fakeClock() })

    expect(result.verdict).toBe(EWebGateVerdict.TimedOut)
  })
})
