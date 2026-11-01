import { db } from '@dltech/atlas-db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { failureText } from '../github/github-sandbox-wake-boot'
import { PodLaunchService } from './pod-launch.service'
import { stuckSessionTargets, type StuckSessionTarget } from './stuck-sessions'

export const RECOVERY_CAP_PER_RUN = 10

export const PROBE_TIMEOUT_MS = 5_000

const HEALTH_PATH = '/v1/health'

const GONE_STATUSES: readonly number[] = [404, 410]

export enum EStuckRecoveryOutcome {
  Recovered = 'recovered',
  Alive = 'alive',
  Skipped = 'skipped',
}

export type StuckRecoveryDeps = {
  pod: Pick<PodLaunchService, 'credentialsOf' | 'claim' | 'dispatchClaimed'>
  cipher: Pick<SecretCipherService, 'decrypt'>
  fetch: typeof fetch
  log: (line: string) => void
  now?: (() => Date) | undefined
}

export type StuckRecoverySummary = { candidates: number; recovered: number; alive: number }

export async function serveIsDead(args: {
  serveUrl: string
  token: string
  fetch: typeof fetch
}): Promise<boolean> {
  try {
    const response = await args.fetch(new URL(HEALTH_PATH, args.serveUrl), {
      headers: { authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return response.status >= 500 || GONE_STATUSES.includes(response.status)
  } catch {
    return true
  }
}

function tokenOf(args: { target: StuckSessionTarget; deps: StuckRecoveryDeps }): string | null {
  const { sealedToken, name } = args.target.sandbox
  if (sealedToken === null) return null
  try {
    return args.deps.cipher.decrypt(sealedToken)
  } catch (failure) {
    args.deps.log(`stuck-session sweep cannot unseal the token of ${name}: ${failureText(failure)}`)
    return null
  }
}

async function probeAll(args: {
  targets: readonly StuckSessionTarget[]
  deps: StuckRecoveryDeps
}): Promise<Array<{ target: StuckSessionTarget; dead: boolean | null }>> {
  return Promise.all(
    args.targets.map(async (target) => {
      const serveUrl = target.sandbox.serveUrl
      const token = tokenOf({ target, deps: args.deps })
      if (serveUrl === null || token === null) return { target, dead: null }
      return { target, dead: await serveIsDead({ serveUrl, token, fetch: args.deps.fetch }) }
    }),
  )
}

async function recover(args: {
  target: StuckSessionTarget
  deps: StuckRecoveryDeps
}): Promise<EStuckRecoveryOutcome> {
  const { target, deps } = args
  const thread = await db.orm.public.Thread.where({ id: target.threadId }).all().first()
  if (thread === null) return EStuckRecoveryOutcome.Skipped
  const gap = await deps.pod.credentialsOf({ userId: thread.userId })
  if (gap !== null) return EStuckRecoveryOutcome.Skipped
  const claim = await deps.pod.claim({ thread, existing: target.sandbox })
  if (claim === null) return EStuckRecoveryOutcome.Skipped
  const dispatched = await deps.pod.dispatchClaimed({ thread, claim })
  deps.log(
    `stuck-session sweep re-provisioning sandbox ${target.sandbox.id} for thread ${target.threadId}: ` +
      `serve at ${target.sandbox.serveUrl} is unreachable, user input unanswered since ` +
      `${target.unansweredSince.toISOString()}${dispatched ? '' : ' (dispatch failed)'}`,
  )
  return dispatched ? EStuckRecoveryOutcome.Recovered : EStuckRecoveryOutcome.Skipped
}

export async function recoverStuckSessions(args: {
  deps: StuckRecoveryDeps
}): Promise<StuckRecoverySummary> {
  const { deps } = args
  const targets = await stuckSessionTargets({ now: deps.now?.() })
  const summary: StuckRecoverySummary = { candidates: targets.length, recovered: 0, alive: 0 }
  for (let start = 0; start < targets.length; start += RECOVERY_CAP_PER_RUN) {
    const probed = await probeAll({
      targets: targets.slice(start, start + RECOVERY_CAP_PER_RUN),
      deps,
    })
    for (const { target, dead } of probed) {
      if (dead === false) summary.alive += 1
      if (dead !== true || summary.recovered >= RECOVERY_CAP_PER_RUN) continue
      const outcome = await recover({ target, deps })
      if (outcome === EStuckRecoveryOutcome.Recovered) summary.recovered += 1
    }
    if (summary.recovered >= RECOVERY_CAP_PER_RUN) break
  }
  return summary
}
