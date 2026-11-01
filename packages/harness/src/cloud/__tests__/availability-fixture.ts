import {
  ECredentialAvailability,
  ECredentialFence,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  toAccountId,
  type AdmissionPermit,
  type AvailabilityKey,
  type CredentialRevision,
  type NormalizedProviderFailure,
} from '@dltech/atlas-core'

import { CloudClient } from '../cloud-client'
import { isTrpcUrl, trpcCallOf, trpcData, trpcError, type TrpcCall } from './accounts-trpc-fake'

export const key: AvailabilityKey = {
  accountId: toAccountId('acct_1'),
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
}
export const revision: CredentialRevision = {
  fence: ECredentialFence.Refreshed,
  value: 3,
}
export const PERMIT_ID = '7b0f5c52-6d34-4a3b-9a63-0d6c1d5f1111'

export const probePermit: AdmissionPermit = {
  key,
  revision,
  probe: true,
  admittedAt: '2026-11-01T12:00:00.000Z',
  permitId: PERMIT_ID,
}

export const quotaFailure: NormalizedProviderFailure = {
  kind: EProviderFailureKind.Quota,
  scope: EProviderFailureScope.Credential,
  retry: EProviderRetry.Never,
  message: 'quota exhausted',
  resetAt: '2026-11-01T18:00:00.000Z',
}

export const snapshotBody = {
  key,
  availability: ECredentialAvailability.QuotaExhausted,
  revision,
  since: '2026-11-01T12:00:00.000Z',
}

export type Reply = { data: unknown } | { status: number; message: string }

export const clientAnswering = (
  respond: (call: TrpcCall) => Reply,
): { client: CloudClient; calls: TrpcCall[] } => {
  const calls: TrpcCall[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (!isTrpcUrl(url)) return new Response('not found', { status: 404 })
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const call = trpcCallOf({ url, body })
    calls.push(call)
    const reply = respond(call)
    return 'data' in reply ? trpcData(reply.data) : trpcError(reply)
  }) as typeof fetch
  return {
    client: new CloudClient({
      url: 'http://cloud.test',
      token: 'tok',
      fetchFn,
    }),
    calls,
  }
}
