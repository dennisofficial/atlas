import { toAccountId } from '../../credentials/account'
import type { AvailabilityKey } from '../../credentials/credential-availability'
import type { EventBody } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toEventId, toRunId, toThreadId, type ThreadId } from '../../events/ids'
import { stampEvent } from '../../events/stamp'
import { EProviderFailureKind } from '../../models/provider-failure'
import {
  EModelWaitCause,
  EWaitEpisodeKind,
  type WaitEpisodeRef,
  type WaitingForModel,
} from '../waiting'

export const keyOf = (accountId: string, modelId = 'claude-sonnet'): AvailabilityKey => ({
  accountId: toAccountId(accountId),
  providerId: 'anthropic',
  modelId,
})

export const credentialEpisode = (args: {
  accountId: string
  generation: number
  modelId?: string
}): WaitEpisodeRef => ({
  kind: EWaitEpisodeKind.Credential,
  key: keyOf(args.accountId, args.modelId),
  generation: args.generation,
})

export const controlPlaneEpisode = (
  code: string,
  modelId: string | null = null,
): WaitEpisodeRef => ({
  kind: EWaitEpisodeKind.ControlPlane,
  code,
  providerId: 'anthropic',
  modelId,
})

export const waiting = (
  overrides: Partial<WaitingForModel> & { episode: WaitEpisodeRef },
): WaitingForModel => ({
  cause:
    overrides.episode.kind === EWaitEpisodeKind.Credential
      ? EModelWaitCause.Availability
      : EModelWaitCause.ControlPlane,
  providerId: 'anthropic',
  accountId:
    overrides.episode.kind === EWaitEpisodeKind.Credential ? overrides.episode.key.accountId : null,
  modelId: null,
  reason: EProviderFailureKind.Quota,
  resetAt: null,
  affectedThreadIds: [toThreadId('t1')],
  ...overrides,
})

let seq = 0
export const stamp = (body: EventBody): Event => {
  seq += 1
  const envelope = {
    id: toEventId(`e${seq}`),
    seq,
    threadId: toThreadId('root'),
    runId: toRunId('r1'),
    depth: 0,
    at: '2026-11-01T00:00:00.000Z',
  }
  return stampEvent({ draft: body, envelope })
}

export const waits = (value: WaitingForModel): Event =>
  stamp({ type: 'model-waiting', waiting: value })
export const clears = (episode: WaitEpisodeRef): Event =>
  stamp({
    type: 'model-wait-cleared',
    episode,
    cause:
      episode.kind === EWaitEpisodeKind.Credential
        ? EModelWaitCause.Availability
        : EModelWaitCause.ControlPlane,
  })

export const threads = (...ids: string[]): readonly ThreadId[] => ids.map(toThreadId)
