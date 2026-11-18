import { deployOf } from './render-deploy-of'

const RENDER_API = 'https://api.render.com/v1'
const HEALTH_URL = 'https://api.byatlas.io/healthz'
const SETTLE_TIMEOUT_MS = 25 * 60_000
const SETTLE_POLL_MS = 10_000
const PROBE_ATTEMPTS = 6
const PROBE_INTERVAL_MS = 10_000
const PROBE_TIMEOUT_MS = 30_000
const DEPLOY_LIMIT = 20
const DETAIL_LIMIT = 500

export enum EGateVerdict {
  Live = 'live',
  Superseded = 'superseded',
  Failed = 'failed',
  Unhealthy = 'unhealthy',
  TimedOut = 'timed-out',
}

// https://api-docs.render.com/reference/list-deploys
export enum EDeployStatus {
  Created = 'created',
  Queued = 'queued',
  BuildInProgress = 'build_in_progress',
  UpdateInProgress = 'update_in_progress',
  PreDeployInProgress = 'pre_deploy_in_progress',
  Live = 'live',
  Deactivated = 'deactivated',
  BuildFailed = 'build_failed',
  UpdateFailed = 'update_failed',
  PreDeployFailed = 'pre_deploy_failed',
  Canceled = 'canceled',
}

export enum EDeployJudgement {
  Live = 'live',
  Superseded = 'superseded',
  Failed = 'failed',
  Waiting = 'waiting',
}

export type DeployJudgement = { verdict: EDeployJudgement; detail: string }

export type GateResult = { verdict: EGateVerdict; detail: string }

export type GateConfig = { token: string; serviceId: string; sha: string }

export type GateClock = { now: () => number; sleep: (ms: number) => Promise<void> }

export type RenderDeploy = { id: string; status: string; commitId: string }

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

function deploysFrom(body: unknown): RenderDeploy[] {
  if (!Array.isArray(body)) throw new Error('the deploys answer is not a list')
  return body.flatMap((entry) => {
    const deploy = deployOf(entry)
    return deploy === undefined ? [] : [deploy]
  })
}

async function listDeploys({
  config,
  fetcher,
}: {
  config: GateConfig
  fetcher: Fetcher
}): Promise<RenderDeploy[]> {
  const query = new URLSearchParams({ limit: String(DEPLOY_LIMIT) })
  const response = await fetcher(`${RENDER_API}/services/${config.serviceId}/deploys?${query}`, {
    headers: { authorization: `Bearer ${config.token}` },
  })
  if (!response.ok) {
    throw new Error(`listing deploys answered ${response.status}: ${await response.text()}`)
  }
  return deploysFrom(await response.json())
}

export function judgeDeploy({
  deploys,
  sha,
}: {
  deploys: readonly RenderDeploy[]
  sha: string
}): DeployJudgement {
  const index = deploys.findIndex((deploy) => deploy.commitId === sha)
  const deploy = index < 0 ? undefined : deploys[index]
  if (deploy === undefined) {
    return { verdict: EDeployJudgement.Waiting, detail: `no deploy of ${sha} yet` }
  }

  switch (deploy.status) {
    case EDeployStatus.Live:
      return { verdict: EDeployJudgement.Live, detail: `deploy ${deploy.id} of ${sha} is live` }
    case EDeployStatus.Deactivated:
    case EDeployStatus.Canceled: {
      const newer = deploys
        .slice(0, index)
        .find((candidate) => candidate.status === EDeployStatus.Live)
      if (newer === undefined) {
        return {
          verdict: EDeployJudgement.Waiting,
          detail: `deploy ${deploy.id} of ${sha} is ${deploy.status} with no live deploy after it`,
        }
      }
      return {
        verdict: EDeployJudgement.Superseded,
        detail: `deploy ${deploy.id} of ${sha} is ${deploy.status}; ${newer.commitId} is live instead`,
      }
    }
    case EDeployStatus.BuildFailed:
    case EDeployStatus.UpdateFailed:
    case EDeployStatus.PreDeployFailed:
      return {
        verdict: EDeployJudgement.Failed,
        detail: `deploy ${deploy.id} of ${sha} ended ${deploy.status}`,
      }
    case EDeployStatus.Created:
    case EDeployStatus.Queued:
    case EDeployStatus.BuildInProgress:
    case EDeployStatus.UpdateInProgress:
    case EDeployStatus.PreDeployInProgress:
      return {
        verdict: EDeployJudgement.Waiting,
        detail: `deploy ${deploy.id} of ${sha} is ${deploy.status}`,
      }
    default:
      return {
        verdict: EDeployJudgement.Failed,
        detail: `deploy ${deploy.id} of ${sha} reports the unrecognized status ${deploy.status}`,
      }
  }
}

async function probeOnce({ fetcher }: { fetcher: Fetcher }): Promise<{
  healthy: boolean
  detail: string
}> {
  try {
    const response = await fetcher(HEALTH_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    const body = (await response.text()).slice(0, DETAIL_LIMIT)
    return { healthy: response.status === 200, detail: `${response.status} ${body}` }
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function probeHealth({
  fetcher,
  clock,
}: {
  fetcher: Fetcher
  clock: GateClock
}): Promise<{ healthy: boolean; detail: string }> {
  let detail = ''
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    const probe = await probeOnce({ fetcher })
    if (probe.healthy) return { healthy: true, detail: `${HEALTH_URL} ${probe.detail}` }
    detail = probe.detail
    if (attempt < PROBE_ATTEMPTS) await clock.sleep(PROBE_INTERVAL_MS)
  }
  return {
    healthy: false,
    detail: `${HEALTH_URL} failed ${PROBE_ATTEMPTS} probes; last answer: ${detail}`,
  }
}

const PROBED_VERDICTS: Partial<Record<EDeployJudgement, EGateVerdict>> = {
  [EDeployJudgement.Live]: EGateVerdict.Live,
  [EDeployJudgement.Superseded]: EGateVerdict.Superseded,
}

async function probeSettled({
  judgement,
  verdict,
  fetcher,
  clock,
}: {
  judgement: DeployJudgement
  verdict: EGateVerdict
  fetcher: Fetcher
  clock: GateClock
}): Promise<GateResult> {
  const probe = await probeHealth({ fetcher, clock })
  if (!probe.healthy) return { verdict: EGateVerdict.Unhealthy, detail: probe.detail }
  return { verdict, detail: `${judgement.detail}; ${probe.detail}` }
}

export type LiveContains = (args: { liveCommit: string; sha: string }) => Promise<boolean>

async function withNewerLive({
  judgement,
  deploys,
  sha,
  liveContains,
}: {
  judgement: DeployJudgement
  deploys: readonly RenderDeploy[]
  sha: string
  liveContains: LiveContains | undefined
}): Promise<DeployJudgement> {
  if (judgement.verdict !== EDeployJudgement.Waiting || liveContains === undefined) return judgement
  if (deploys.some((deploy) => deploy.commitId === sha)) return judgement
  const live = deploys.find((deploy) => deploy.status === EDeployStatus.Live)
  if (live === undefined || !(await liveContains({ liveCommit: live.commitId, sha }))) {
    return judgement
  }
  return {
    verdict: EDeployJudgement.Superseded,
    detail: `${sha} got no deploy of its own; ${live.commitId}, which contains it, is live`,
  }
}

export async function runDeployGate({
  config,
  fetcher,
  clock,
  liveContains,
}: {
  config: GateConfig
  fetcher: Fetcher
  clock: GateClock
  liveContains?: LiveContains | undefined
}): Promise<GateResult> {
  const deadline = clock.now() + SETTLE_TIMEOUT_MS
  let judgement: DeployJudgement = { verdict: EDeployJudgement.Waiting, detail: 'nothing listed' }

  while (clock.now() < deadline) {
    const deploys = await listDeploys({ config, fetcher })
    judgement = await withNewerLive({
      judgement: judgeDeploy({ deploys, sha: config.sha }),
      deploys,
      sha: config.sha,
      liveContains,
    })
    if (judgement.verdict === EDeployJudgement.Failed) {
      return { verdict: EGateVerdict.Failed, detail: judgement.detail }
    }
    if (judgement.verdict in PROBED_VERDICTS) {
      const verdict = PROBED_VERDICTS[judgement.verdict]
      if (verdict !== undefined) return probeSettled({ judgement, verdict, fetcher, clock })
    }
    await clock.sleep(SETTLE_POLL_MS)
  }

  return {
    verdict: EGateVerdict.TimedOut,
    detail: `nothing settled within ${SETTLE_TIMEOUT_MS / 60_000} minutes; last seen: ${judgement.detail}`,
  }
}

const PASSING_VERDICTS: readonly EGateVerdict[] = [EGateVerdict.Live, EGateVerdict.Superseded]

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function gitContains({ liveCommit, sha }: { liveCommit: string; sha: string }) {
  await Bun.spawn(['git', 'fetch', '--quiet', 'origin', liveCommit]).exited
  const ancestry = Bun.spawn(['git', 'merge-base', '--is-ancestor', sha, liveCommit])
  return (await ancestry.exited) === 0
}

if (import.meta.main) {
  const result = await runDeployGate({
    config: {
      token: requireEnv('RENDER_API_KEY'),
      serviceId: requireEnv('RENDER_SERVICE_ID'),
      sha: requireEnv('GITHUB_SHA'),
    },
    fetcher: fetch,
    clock: { now: Date.now, sleep: (ms) => Bun.sleep(ms) },
    liveContains: process.env.ACCEPT_NEWER_LIVE_COMMIT === '1' ? gitContains : undefined,
  })
  if (!PASSING_VERDICTS.includes(result.verdict)) {
    console.error(`::error::${result.verdict}: ${result.detail}`)
    process.exit(1)
  }
  console.log(`${result.verdict}: ${result.detail}`)
}
