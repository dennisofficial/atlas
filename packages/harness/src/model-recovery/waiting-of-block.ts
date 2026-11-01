import {
  ECredentialAvailability,
  EModelWaitCause,
  EWaitEpisodeKind,
  type ThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'

import { blockedFailureOf, type ModelAdmissionBlockedError } from '../model/admission-blocked'

export function waitingOfBlock({
  error,
  threadId,
}: {
  error: ModelAdmissionBlockedError
  threadId: ThreadId
}): WaitingForModel {
  const { key, snapshot } = error.block
  const failure = blockedFailureOf([error])
  const manualOnly = snapshot.availability === ECredentialAvailability.Paused
  return {
    episode: {
      kind: EWaitEpisodeKind.Credential,
      key,
      generation: snapshot.revision.value,
    },
    cause: EModelWaitCause.Availability,
    providerId: key.providerId,
    accountId: key.accountId,
    modelId: key.modelId,
    reason: manualOnly || failure === undefined ? null : failure.kind,
    resetAt: failure?.resetAt ?? null,
    affectedThreadIds: [threadId],
  }
}
