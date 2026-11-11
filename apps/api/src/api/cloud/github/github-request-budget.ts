import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { GithubRequestIdentity } from './github-observation.types'
export const credentialFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex')
import { HttpException, HttpStatus, Logger } from '@nestjs/common'

export type GithubHttpBudget = {
  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean>
  httpCooldownUntil?(identity: GithubRequestIdentity): Promise<number>
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
}
const scope = new AsyncLocalStorage<GithubHttpBudget>()
const logger = new Logger('GithubBudget')

export enum EGithubBudgetRefusal {
  Window = 'window',
  Cooldown = 'cooldown',
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
  return args.until === undefined
    ? new GithubHttpBudgetUnavailable(args.refusal)
    : new GithubCredentialCooldown(args.until)
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
  throw refuse({ refusal: EGithubBudgetRefusal.Window, identity })
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
