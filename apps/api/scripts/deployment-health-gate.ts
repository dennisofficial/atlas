const VERCEL_API = 'https://api.vercel.com'
const SETTLE_TIMEOUT_MS = 20 * 60_000
const SETTLE_POLL_MS = 10_000
const PROBE_ATTEMPTS = 6
const PROBE_INTERVAL_MS = 10_000
const PROBE_TIMEOUT_MS = 30_000
const DETAIL_LIMIT = 500

export enum EGateVerdict {
  Healthy = 'healthy',
  NotDeployed = 'not-deployed',
  Unhealthy = 'unhealthy',
}

enum EDeploymentState {
  Ready = 'READY',
  Error = 'ERROR',
  Canceled = 'CANCELED',
}

export type GateResult = { verdict: EGateVerdict; detail: string }

export type GateConfig = {
  token: string
  teamId: string
  projectId: string
  sha: string
  bypassSecret: string
}

export type GateClock = { now: () => number; sleep: (ms: number) => Promise<void> }

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

type Deployment = { url: string; state: string }

const SETTLED_STATES: readonly string[] = Object.values(EDeploymentState)

function isDeployment(value: unknown): value is Deployment {
  if (typeof value !== 'object' || value === null) return false
  return (
    'url' in value &&
    typeof value.url === 'string' &&
    'state' in value &&
    typeof value.state === 'string'
  )
}

function firstDeployment(body: unknown): Deployment | undefined {
  if (typeof body !== 'object' || body === null || !('deployments' in body)) return undefined
  if (!Array.isArray(body.deployments)) return undefined
  const [first] = body.deployments
  return isDeployment(first) ? first : undefined
}

async function latestDeployment({
  config,
  fetcher,
}: {
  config: GateConfig
  fetcher: Fetcher
}): Promise<Deployment | undefined> {
  const query = new URLSearchParams({
    teamId: config.teamId,
    projectId: config.projectId,
    target: 'production',
    'meta-githubCommitSha': config.sha,
    limit: '1',
  })
  const response = await fetcher(`${VERCEL_API}/v6/deployments?${query}`, {
    headers: { authorization: `Bearer ${config.token}` },
  })
  if (!response.ok) {
    throw new Error(`listing deployments answered ${response.status}: ${await response.text()}`)
  }
  return firstDeployment(await response.json())
}

async function settledDeployment({
  config,
  fetcher,
  clock,
}: {
  config: GateConfig
  fetcher: Fetcher
  clock: GateClock
}): Promise<Deployment | undefined> {
  const deadline = clock.now() + SETTLE_TIMEOUT_MS
  while (clock.now() < deadline) {
    const deployment = await latestDeployment({ config, fetcher })
    if (deployment && SETTLED_STATES.includes(deployment.state)) return deployment
    await clock.sleep(SETTLE_POLL_MS)
  }
  return undefined
}

async function probeOnce({
  url,
  bypassSecret,
  fetcher,
}: {
  url: string
  bypassSecret: string
  fetcher: Fetcher
}): Promise<{ healthy: boolean; detail: string }> {
  try {
    const response = await fetcher(`https://${url}/v1/health`, {
      headers: { 'x-vercel-protection-bypass': bypassSecret },
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const body = (await response.text()).slice(0, DETAIL_LIMIT)
    return { healthy: response.status === 200, detail: `${response.status} ${body}` }
  } catch (error) {
    return { healthy: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function probeHealth({
  url,
  config,
  fetcher,
  clock,
}: {
  url: string
  config: GateConfig
  fetcher: Fetcher
  clock: GateClock
}): Promise<GateResult> {
  let detail = ''
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    const probe = await probeOnce({ url, bypassSecret: config.bypassSecret, fetcher })
    if (probe.healthy) return { verdict: EGateVerdict.Healthy, detail: `${url} ${probe.detail}` }
    detail = probe.detail
    if (attempt < PROBE_ATTEMPTS) await clock.sleep(PROBE_INTERVAL_MS)
  }
  return {
    verdict: EGateVerdict.Unhealthy,
    detail: `${url}/v1/health failed ${PROBE_ATTEMPTS} probes; last answer: ${detail}`,
  }
}

export async function runHealthGate({
  config,
  fetcher,
  clock,
}: {
  config: GateConfig
  fetcher: Fetcher
  clock: GateClock
}): Promise<GateResult> {
  const deployment = await settledDeployment({ config, fetcher, clock })
  if (!deployment) {
    return {
      verdict: EGateVerdict.Unhealthy,
      detail: `no production deployment of ${config.sha} settled within ${SETTLE_TIMEOUT_MS / 60_000} minutes`,
    }
  }
  if (deployment.state === EDeploymentState.Canceled) {
    return {
      verdict: EGateVerdict.NotDeployed,
      detail: `the deployment of ${config.sha} was canceled (the push did not affect the API)`,
    }
  }
  if (deployment.state === EDeploymentState.Error) {
    return { verdict: EGateVerdict.Unhealthy, detail: `${deployment.url} failed to build` }
  }
  return probeHealth({ url: deployment.url, config, fetcher, clock })
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

if (import.meta.main) {
  const result = await runHealthGate({
    config: {
      token: requireEnv('VERCEL_TOKEN'),
      teamId: requireEnv('VERCEL_TEAM_ID'),
      projectId: requireEnv('VERCEL_PROJECT_ID'),
      sha: requireEnv('GITHUB_SHA'),
      bypassSecret: requireEnv('VERCEL_AUTOMATION_BYPASS_SECRET'),
    },
    fetcher: fetch,
    clock: { now: Date.now, sleep: (ms) => Bun.sleep(ms) },
  })
  if (result.verdict === EGateVerdict.Unhealthy) {
    console.error(`::error::${result.detail}`)
    process.exit(1)
  }
  console.log(`${result.verdict}: ${result.detail}`)
}
