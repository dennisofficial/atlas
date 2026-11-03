import { EVercelPlan } from '@dltech/atlas-wire/web'
import type { VercelFetch } from './vercel-oauth.types'

export const PLAN_READ_TIMEOUT_MS = 10_000

export class VercelApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'VercelApiError'
  }
}

async function getJson(args: {
  fetch: VercelFetch
  token: string
  path: string
}): Promise<unknown> {
  const response = await args.fetch(`https://api.vercel.com${args.path}`, {
    headers: { authorization: `Bearer ${args.token}` },
    signal: AbortSignal.timeout(PLAN_READ_TIMEOUT_MS),
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = payload as { error?: { message?: unknown } } | null
    const message =
      typeof parsed?.error?.message === 'string' ? parsed.error.message : response.statusText
    throw new VercelApiError(response.status, message.slice(0, 300))
  }
  return payload
}

// billing.plan is observed on GET /v2/teams/{teamId} but undocumented; absent stays unknown
function planValueOf(payload: unknown): EVercelPlan {
  const billing = (payload as { billing?: unknown } | null)?.billing
  const plan = (billing as { plan?: unknown } | null)?.plan
  if (plan === EVercelPlan.Hobby) return EVercelPlan.Hobby
  if (plan === EVercelPlan.Pro) return EVercelPlan.Pro
  if (plan === EVercelPlan.Enterprise) return EVercelPlan.Enterprise
  return EVercelPlan.Unknown
}

export async function readVercelPlan(args: {
  fetch: VercelFetch
  token: string
  teamId: string
}): Promise<EVercelPlan> {
  if (args.teamId.startsWith('team_')) {
    const team = await getJson({
      fetch: args.fetch,
      token: args.token,
      path: `/v2/teams/${args.teamId}`,
    })
    return planValueOf(team)
  }
  const user = await getJson({ fetch: args.fetch, token: args.token, path: '/v2/user' })
  return planValueOf((user as { user?: unknown } | null)?.user ?? user)
}

export type VercelTeamListing = { id: string; slug: string; plan: EVercelPlan }

export async function listVercelTeams(args: {
  fetch: VercelFetch
  token: string
}): Promise<VercelTeamListing[]> {
  const payload = await getJson({
    fetch: args.fetch,
    token: args.token,
    path: '/v2/teams?limit=100',
  })
  const teams = (payload as { teams?: unknown } | null)?.teams
  if (!Array.isArray(teams)) return []
  return teams.flatMap((entry) => {
    const team = entry as { id?: unknown; slug?: unknown }
    if (typeof team.id !== 'string') return []
    return [
      {
        id: team.id,
        slug: typeof team.slug === 'string' ? team.slug : '',
        plan: planValueOf(entry),
      },
    ]
  })
}

export type VercelProjectListing = { id: string; name: string }

export async function listVercelProjects(args: {
  fetch: VercelFetch
  token: string
  teamId: string
}): Promise<VercelProjectListing[]> {
  const params = new URLSearchParams({ teamId: args.teamId, limit: '100' })
  const payload = await getJson({
    fetch: args.fetch,
    token: args.token,
    path: `/v9/projects?${params.toString()}`,
  })
  const projects = (payload as { projects?: unknown } | null)?.projects
  if (!Array.isArray(projects)) return []
  return projects.flatMap((entry) => {
    const project = entry as { id?: unknown; name?: unknown }
    if (typeof project.id !== 'string' || typeof project.name !== 'string') return []
    return [{ id: project.id, name: project.name }]
  })
}
