import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import type { GithubRequestIdentity } from './github-observation.types'
export const credentialFingerprint = (token: string): string =>
  createHash('sha256').update(token).digest('hex')
import { HttpException, HttpStatus } from '@nestjs/common'

export type GithubHttpBudget = {
  takeHttpSlot(identity?: GithubRequestIdentity): Promise<boolean>
  httpCooldownUntil?(identity: GithubRequestIdentity): Promise<number>
  blockHttpUntil(args: { until: number } & Partial<GithubRequestIdentity>): Promise<void>
}
const scope = new AsyncLocalStorage<GithubHttpBudget>()

export class GithubHttpBudgetUnavailable extends HttpException {
  readonly rateLimited = true
  constructor() {
    super(
      'GitHub HTTP budget or shared coordinator unavailable; retry later',
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}

export class GithubCredentialCooldown extends GithubHttpBudgetUnavailable {}

export function withGithubRequestBudget<T>(args: {
  store: GithubHttpBudget
  run: () => Promise<T>
}): Promise<T> {
  return scope.run(args.store, args.run)
}

export async function takeGithubRequestSlot(identity: GithubRequestIdentity): Promise<void> {
  const budget = scope.getStore()
  if (budget === undefined) return
  let coolingDown = false
  try {
    if (await budget.takeHttpSlot(identity)) return
    coolingDown = ((await budget.httpCooldownUntil?.(identity)) ?? 0) > Date.now()
  } catch {
    throw new GithubHttpBudgetUnavailable()
  }
  if (coolingDown) throw new GithubCredentialCooldown()
  throw new GithubHttpBudgetUnavailable()
}

export async function blockGithubRequests(
  args: { until: number } & GithubRequestIdentity,
): Promise<void> {
  await scope.getStore()?.blockHttpUntil(args)
}
