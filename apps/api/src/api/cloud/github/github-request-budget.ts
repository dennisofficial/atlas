import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import {
  GITHUB_HTTP_LOW_WATER_RATIO,
  type GithubRequestIdentity,
} from './github-request-coordinator.types'
export const credentialFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex')
import { HttpException, HttpStatus, Logger } from '@nestjs/common'

export type GithubHttpBudget = {
  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean>
  httpCooldownUntil?(identity: GithubRequestIdentity): Promise<number>
  httpReserveUntil?(identity: GithubRequestIdentity): Promise<number>
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
  holdHttpReserve?(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
}
const scope = new AsyncLocalStorage<GithubHttpBudget>()
const logger = new Logger('GithubBudget')

export enum EGithubBudgetRefusal {
  Window = 'window',
  Cooldown = 'cooldown',
  Quota = 'quota',
  Coordinator = 'coordinator',
}

const minutesUntil = (until: number): number =>
  Math.max(1, Math.ceil((until - Date.now()) / 60_000))

const clockOf = (until: number): string => new Date(until).toISOString().slice(11, 16)

const messageOf = (args: { refusal: EGithubBudgetRefusal; until?: number | undefined }): string => {
  if (args.refusal === EGithubBudgetRefusal.Cooldown) {
    const until = args.until ?? Date.now()
    return `GitHub rate-limited this connection: Atlas holds GitHub calls for ${minutesUntil(until)} more minutes (until ${clockOf(until)} UTC).`
  }
  if (args.refusal === EGithubBudgetRefusal.Quota) {
    const until = args.until ?? Date.now()
    return `GitHub has almost no quota left for this connection: Atlas holds background calls for ${minutesUntil(until)} more minutes (until ${clockOf(until)} UTC) so deliveries still arrive.`
  }
  if (args.refusal === EGithubBudgetRefusal.Coordinator)
    return 'Atlas could not reach its GitHub request coordinator, so it is holding GitHub calls. Retry in a moment.'
  return "Atlas is pacing its own GitHub calls: this minute's budget is spent. GitHub still has quota; retry in a few seconds."
}

export class GithubHttpBudgetUnavailable extends HttpException {
  readonly rateLimited = true
  readonly parked = true
  constructor(
    readonly refusal: EGithubBudgetRefusal = EGithubBudgetRefusal.Window,
    readonly until?: number,
  ) {
    super(messageOf({ refusal, until }), HttpStatus.TOO_MANY_REQUESTS)
  }
}

export class GithubCredentialCooldown extends GithubHttpBudgetUnavailable {
  constructor(until: number) {
    super(EGithubBudgetRefusal.Cooldown, until)
  }
}

/**
 * A refusal is not a failure: the work it belonged to is still valid and will run as soon as the
 * window has room. Callers that durably queue work must park it, never charge it an attempt.
 */
export const isGithubBudgetParked = (failure: unknown): boolean =>
  typeof failure === 'object' &&
  failure !== null &&
  (failure as { parked?: boolean }).parked === true

export function withGithubRequestBudget<T>(args: {
  store: GithubHttpBudget
  run: () => Promise<T>
}): Promise<T> {
  return scope.run(args.store, args.run)
}

const detailOf = (failure: unknown): string =>
  failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)

const refuse = (args: {
  refusal: EGithubBudgetRefusal
  identity: GithubRequestIdentity
  until?: number
  detail?: string
}): GithubHttpBudgetUnavailable => {
  logger.warn(
    JSON.stringify({
      refusal: args.refusal,
      source: args.identity.source ?? 'unattributed',
      category: args.identity.category ?? 'unclassified',
      resource: args.identity.resource,
      ...(args.until === undefined
        ? {}
        : {
            until: new Date(args.until).toISOString(),
            inSeconds: Math.max(0, Math.ceil((args.until - Date.now()) / 1_000)),
          }),
      ...(args.detail === undefined ? {} : { detail: args.detail }),
    }),
  )
  if (args.until === undefined) return new GithubHttpBudgetUnavailable(args.refusal)
  return args.refusal === EGithubBudgetRefusal.Cooldown
    ? new GithubCredentialCooldown(args.until)
    : new GithubHttpBudgetUnavailable(args.refusal, args.until)
}

export async function takeGithubRequestSlot(identity: GithubRequestIdentity): Promise<void> {
  const budget = scope.getStore()
  if (budget === undefined) return
  let granted: boolean
  try {
    granted = await budget.takeHttpSlot(identity)
  } catch (failure) {
    throw refuse({
      refusal: EGithubBudgetRefusal.Coordinator,
      identity,
      detail: detailOf(failure),
    })
  }
  if (granted) return
  let until = 0
  try {
    until = (await budget.httpCooldownUntil?.(identity)) ?? 0
  } catch (failure) {
    throw refuse({
      refusal: EGithubBudgetRefusal.Coordinator,
      identity,
      detail: detailOf(failure),
    })
  }
  if (until > Date.now()) throw refuse({ refusal: EGithubBudgetRefusal.Cooldown, identity, until })
  const reserved = await reservedUntil({ budget, identity })
  if (reserved > Date.now())
    throw refuse({ refusal: EGithubBudgetRefusal.Quota, identity, until: reserved })
  throw refuse({ refusal: EGithubBudgetRefusal.Window, identity })
}

async function reservedUntil(args: {
  budget: GithubHttpBudget
  identity: GithubRequestIdentity
}): Promise<number> {
  if (args.identity.essential !== false) return 0
  try {
    return (await args.budget.httpReserveUntil?.(args.identity)) ?? 0
  } catch (failure) {
    throw refuse({
      refusal: EGithubBudgetRefusal.Coordinator,
      identity: args.identity,
      detail: detailOf(failure),
    })
  }
}

export async function recordGithubRateHeadroom(args: {
  identity: GithubRequestIdentity
  remaining: number | null
  limit: number | null
  reset: number | null
}): Promise<void> {
  const { remaining, limit, reset } = args
  if (remaining === null || limit === null || limit <= 0) return
  if (remaining > limit * GITHUB_HTTP_LOW_WATER_RATIO) return
  const until = reset === null ? Date.now() + 60_000 : reset * 1_000
  if (until <= Date.now()) return
  logger.warn(
    JSON.stringify({
      reserve: 'low-water',
      resource: args.identity.resource,
      remaining,
      limit,
      until: new Date(until).toISOString(),
    }),
  )
  await scope.getStore()?.holdHttpReserve?.({ ...args.identity, until })
}

export async function blockGithubRequests(
  args: { until: number } & GithubRequestIdentity,
): Promise<void> {
  logger.warn(
    JSON.stringify({
      blockedBy: args.source ?? 'unattributed',
      resource: args.resource,
      until: new Date(args.until).toISOString(),
      inSeconds: Math.max(0, Math.ceil((args.until - Date.now()) / 1_000)),
    }),
  )
  await scope.getStore()?.blockHttpUntil(args)
}
