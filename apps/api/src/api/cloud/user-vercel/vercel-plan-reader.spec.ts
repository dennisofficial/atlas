import { describe, expect, it } from 'bun:test'
import { EVercelPlan } from '@dltech/atlas-wire/web'
import {
  listVercelProjects,
  listVercelTeams,
  readVercelPlan,
  VercelApiError,
} from './vercel-plan-reader'
import type { VercelFetch } from './vercel-oauth.types'

const fetchJson =
  (replies: Record<string, { status?: number; json: unknown }>): VercelFetch =>
  async (input) => {
    const url = String(input)
    const key = Object.keys(replies).find((path) => url.startsWith(`https://api.vercel.com${path}`))
    if (key === undefined) return new Response('{}', { status: 404 })
    const reply = replies[key] as { status?: number; json: unknown }
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 })
  }

describe('readVercelPlan', () => {
  it('reads the billing plan of a team', async () => {
    const plan = await readVercelPlan({
      fetch: fetchJson({ '/v2/teams/team_1': { json: { billing: { plan: 'enterprise' } } } }),
      token: 't',
      teamId: 'team_1',
    })
    expect(plan).toBe(EVercelPlan.Enterprise)
  })

  it('reads hobby and pro plans', async () => {
    for (const [raw, plan] of [
      ['hobby', EVercelPlan.Hobby],
      ['pro', EVercelPlan.Pro],
    ] as const) {
      expect(
        await readVercelPlan({
          fetch: fetchJson({ '/v2/teams/team_1': { json: { billing: { plan: raw } } } }),
          token: 't',
          teamId: 'team_1',
        }),
      ).toBe(plan)
    }
  })

  it('answers unknown when billing is missing', async () => {
    const plan = await readVercelPlan({
      fetch: fetchJson({ '/v2/teams/team_1': { json: { id: 'team_1' } } }),
      token: 't',
      teamId: 'team_1',
    })
    expect(plan).toBe(EVercelPlan.Unknown)
  })

  it('reads the personal account plan for non-team ids', async () => {
    const plan = await readVercelPlan({
      fetch: fetchJson({ '/v2/user': { json: { user: { billing: { plan: 'pro' } } } } }),
      token: 't',
      teamId: 'personal',
    })
    expect(plan).toBe(EVercelPlan.Pro)
  })

  it('throws a VercelApiError with the message on rejection', async () => {
    const failure = await readVercelPlan({
      fetch: fetchJson({
        '/v2/teams/team_1': { status: 403, json: { error: { message: 'forbidden' } } },
      }),
      token: 'bad',
      teamId: 'team_1',
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(VercelApiError)
    expect((failure as VercelApiError).message).toBe('forbidden')
    expect((failure as VercelApiError).status).toBe(403)
  })
})

describe('listVercelProjects', () => {
  it('maps id and name and skips malformed entries', async () => {
    const projects = await listVercelProjects({
      fetch: fetchJson({
        '/v9/projects': {
          json: {
            projects: [{ id: 'prj_1', name: 'web' }, { id: 3 }, { id: 'prj_2', name: 'api' }],
          },
        },
      }),
      token: 't',
      teamId: 'team_1',
    })
    expect(projects).toEqual([
      { id: 'prj_1', name: 'web' },
      { id: 'prj_2', name: 'api' },
    ])
  })
})

describe('listVercelTeams', () => {
  it('maps teams with their billing plan', async () => {
    const teams = await listVercelTeams({
      fetch: fetchJson({
        '/v2/teams': {
          json: {
            teams: [
              { id: 'team_1', slug: 'acme', billing: { plan: 'pro' } },
              { id: 'team_2', slug: 'other' },
            ],
          },
        },
      }),
      token: 't',
    })
    expect(teams).toEqual([
      { id: 'team_1', slug: 'acme', plan: EVercelPlan.Pro },
      { id: 'team_2', slug: 'other', plan: EVercelPlan.Unknown },
    ])
  })
})
