import type { AccountId, NormalizedProviderFailure } from '@dltech/atlas-core'

import { causeChainOf } from './cause-chain'

export type RequestProvenance = {
  accountId?: AccountId | undefined
  providerId?: string | undefined
  modelId?: string | undefined
  authorizationDelivered?: boolean | undefined
}

const requests = new WeakMap<object, RequestProvenance>()
const normalizations = new WeakMap<object, NormalizedProviderFailure>()

const isObject = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

const dataOf = (link: unknown): unknown =>
  isObject(link) ? (link as { data?: unknown }).data : undefined

export function attachProvenance(args: { error: unknown; provenance: RequestProvenance }): unknown {
  if (isObject(args.error) && !requests.has(args.error)) requests.set(args.error, args.provenance)
  return args.error
}

export function provenanceOf(error: unknown): RequestProvenance | undefined {
  for (const link of causeChainOf(error)) {
    for (const candidate of [link, dataOf(link)]) {
      const found = isObject(candidate) ? requests.get(candidate) : undefined
      if (found !== undefined) return found
    }
  }
  return undefined
}

export function rememberNormalization(args: {
  cause: unknown
  normalized: NormalizedProviderFailure
}): void {
  if (isObject(args.cause)) normalizations.set(args.cause, args.normalized)
}

export function normalizationOf(cause: unknown): NormalizedProviderFailure | undefined {
  return isObject(cause) ? normalizations.get(cause) : undefined
}
