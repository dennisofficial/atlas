const VERCEL_API = 'https://api.vercel.com'
const SETTLE_TIMEOUT_MS = 30 * 60_000
const POLL_MS = 10_000
const DEPLOY_LIMIT = 20

// https://vercel.com/docs/rest-api/deployments/list-deployments
export enum EVercelState {
  Queued = 'QUEUED',
  Initializing = 'INITIALIZING',
  Building = 'BUILDING',
  Ready = 'READY',
  Error = 'ERROR',
  Canceled = 'CANCELED',
  Blocked = 'BLOCKED',
  Deleted = 'DELETED',
}

export enum EReadySubstate {
  Staged = 'STAGED',
  Rolling = 'ROLLING',
  Promoted = 'PROMOTED',
}

export enum EWebJudgement {
  Promotable = 'promotable',
  Live = 'live',
  Superseded = 'superseded',
  Skipped = 'skipped',
  Failed = 'failed',
  Waiting = 'waiting',
}

export enum EWebGateVerdict {
  Live = 'live',
  Superseded = 'superseded',
  Skipped = 'skipped',
  Failed = 'failed',
  TimedOut = 'timed-out',
}

export type WebDeploy = {
  id: string
  projectId: string
  state: string
  substate: string | undefined
  sha: string | undefined
  errorMessage: string | undefined
}

export type WebJudgement = { verdict: EWebJudgement; detail: string; deploy?: WebDeploy }

export type WebGateResult = { verdict: EWebGateVerdict; detail: string }

export type WebGateConfig = {
  token: string
  teamId: string | undefined
  project: string
  sha: string
}

export type GateClock = { now: () => number; sleep: (ms: number) => Promise<void> }

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

function deployOf(entry: unknown): WebDeploy | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const record = entry as Record<string, unknown>
  const id = stringOr(record.uid)
  const projectId = stringOr(record.projectId)
  const state = stringOr(record.readyState) ?? stringOr(record.state)
  if (id === undefined || projectId === undefined || state === undefined) return undefined
  const meta = typeof record.meta === 'object' && record.meta !== null ? record.meta : {}
  return {
    id,
    projectId,
    state,
    substate: stringOr(record.readySubstate),
    sha: stringOr((meta as Record<string, unknown>).githubCommitSha),
    errorMessage: stringOr(record.errorMessage),
  }
}

export function deploysFrom(body: unknown): WebDeploy[] {
  if (typeof body !== 'object' || body === null || !('deployments' in body)) {
    throw new Error('the deployments answer has no deployments list')
  }
  if (!Array.isArray(body.deployments)) throw new Error('the deployments answer is not a list')
  return body.deployments.flatMap((entry) => {
    const deploy = deployOf(entry)
    return deploy === undefined ? [] : [deploy]
  })
}

const isPromoted = (deploy: WebDeploy): boolean =>
  deploy.state === EVercelState.Ready && deploy.substate === EReadySubstate.Promoted

function judgeReady(deploy: WebDeploy): WebJudgement {
  const name = `deployment ${deploy.id}`
  if (deploy.substate === EReadySubstate.Promoted) {
    return { verdict: EWebJudgement.Live, detail: `${name} is serving production` }
  }
  if (deploy.substate === EReadySubstate.Rolling) {
    return { verdict: EWebJudgement.Waiting, detail: `${name} is rolling out` }
  }
  return { verdict: EWebJudgement.Promotable, detail: `${name} is staged`, deploy }
}

export function judgeWebDeploy({
  deploys,
  sha,
}: {
  deploys: readonly WebDeploy[]
  sha: string
}): WebJudgement {
  const index = deploys.findIndex((deploy) => deploy.sha === sha)
  const deploy = index < 0 ? undefined : deploys[index]
  if (deploy === undefined) {
    return { verdict: EWebJudgement.Waiting, detail: `no production deployment of ${sha} yet` }
  }

  const newer = deploys.slice(0, index).find(isPromoted)
  if (newer !== undefined && !isPromoted(deploy)) {
    return {
      verdict: EWebJudgement.Superseded,
      detail: `deployment ${deploy.id} of ${sha} is ${deploy.state}; ${newer.sha ?? newer.id} is already serving`,
    }
  }

  switch (deploy.state) {
    case EVercelState.Ready:
      return judgeReady(deploy)
    case EVercelState.Queued:
    case EVercelState.Initializing:
    case EVercelState.Building:
      return {
        verdict: EWebJudgement.Waiting,
        detail: `deployment ${deploy.id} is ${deploy.state}`,
      }
    case EVercelState.Canceled:
      return {
        verdict: EWebJudgement.Skipped,
        detail: `deployment ${deploy.id} was canceled: ${deploy.errorMessage ?? 'no reason given'}`,
      }
    default:
      return {
        verdict: EWebJudgement.Failed,
        detail: `deployment ${deploy.id} of ${sha} is ${deploy.state}: ${deploy.errorMessage ?? 'no reason given'}`,
      }
  }
}

function teamQuery(config: WebGateConfig): URLSearchParams {
  return new URLSearchParams(config.teamId === undefined ? {} : { teamId: config.teamId })
}

async function listDeploys({
  config,
  fetcher,
}: {
  config: WebGateConfig
  fetcher: Fetcher
}): Promise<WebDeploy[]> {
  const query = teamQuery(config)
  query.set('projectId', config.project)
  query.set('target', 'production')
  query.set('limit', String(DEPLOY_LIMIT))
  const response = await fetcher(`${VERCEL_API}/v7/deployments?${query}`, {
    headers: { authorization: `Bearer ${config.token}` },
  })
  if (!response.ok) {
    throw new Error(`listing deployments answered ${response.status}: ${await response.text()}`)
  }
  return deploysFrom(await response.json())
}

async function promote({
  config,
  deploy,
  fetcher,
}: {
  config: WebGateConfig
  deploy: WebDeploy
  fetcher: Fetcher
}): Promise<void> {
  const url = `${VERCEL_API}/v10/projects/${deploy.projectId}/promote/${deploy.id}?${teamQuery(config)}`
  const response = await fetcher(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}` },
  })
  if (!response.ok) {
    throw new Error(`promoting ${deploy.id} answered ${response.status}: ${await response.text()}`)
  }
}

const SETTLED_VERDICTS: Partial<Record<EWebJudgement, EWebGateVerdict>> = {
  [EWebJudgement.Live]: EWebGateVerdict.Live,
  [EWebJudgement.Superseded]: EWebGateVerdict.Superseded,
  [EWebJudgement.Skipped]: EWebGateVerdict.Skipped,
  [EWebJudgement.Failed]: EWebGateVerdict.Failed,
}

export async function runWebGate({
  config,
  fetcher,
  clock,
}: {
  config: WebGateConfig
  fetcher: Fetcher
  clock: GateClock
}): Promise<WebGateResult> {
  const deadline = clock.now() + SETTLE_TIMEOUT_MS
  const promoted = new Set<string>()
  let judgement: WebJudgement = { verdict: EWebJudgement.Waiting, detail: 'nothing listed' }

  while (clock.now() < deadline) {
    judgement = judgeWebDeploy({ deploys: await listDeploys({ config, fetcher }), sha: config.sha })
    const settled = SETTLED_VERDICTS[judgement.verdict]
    if (settled !== undefined) return { verdict: settled, detail: judgement.detail }
    const deploy = judgement.deploy
    if (judgement.verdict === EWebJudgement.Promotable && deploy && !promoted.has(deploy.id)) {
      await promote({ config, deploy, fetcher })
      promoted.add(deploy.id)
    }
    await clock.sleep(POLL_MS)
  }

  return {
    verdict: EWebGateVerdict.TimedOut,
    detail: `nothing settled within ${SETTLE_TIMEOUT_MS / 60_000} minutes; last seen: ${judgement.detail}`,
  }
}

const PASSING_VERDICTS: readonly EWebGateVerdict[] = [
  EWebGateVerdict.Live,
  EWebGateVerdict.Superseded,
  EWebGateVerdict.Skipped,
]

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

if (import.meta.main) {
  const result = await runWebGate({
    config: {
      token: requireEnv('VERCEL_TOKEN'),
      teamId: process.env.VERCEL_TEAM_ID || undefined,
      project: requireEnv('VERCEL_WEB_PROJECT'),
      sha: requireEnv('GITHUB_SHA'),
    },
    fetcher: fetch,
    clock: { now: Date.now, sleep: (ms) => Bun.sleep(ms) },
  })
  if (!PASSING_VERDICTS.includes(result.verdict)) {
    console.error(`::error::${result.verdict}: ${result.detail}`)
    process.exit(1)
  }
  console.log(`${result.verdict}: ${result.detail}`)
}
