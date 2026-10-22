import {
  ESshSigningKeyState,
  GITHUB_NOT_CONNECTED_CODE,
  SSH_SIGNING_SCOPE_MISSING_CODE,
} from '@dltech/atlas-wire'

import { CloudError } from './cloud-transport'
import { generateSigningKeyPair } from './openssh-keygen'
import type { SigningKeyClient } from './signing-key-client'

const CONFLICT_STATUS = 409

export enum ESigningKeyOutcome {
  Registered = 'registered',
  AlreadyRegistered = 'already-registered',
  Rotated = 'rotated',
  Removed = 'removed',
  ScopeMissing = 'scope-missing',
  GithubNotConnected = 'github-not-connected',
  Unavailable = 'unavailable',
}

const outcomeOfFailure = (args: {
  error: unknown
  conflict: ESigningKeyOutcome
}): ESigningKeyOutcome => {
  if (!(args.error instanceof CloudError)) return ESigningKeyOutcome.Unavailable
  if (args.error.code === SSH_SIGNING_SCOPE_MISSING_CODE) return ESigningKeyOutcome.ScopeMissing
  if (args.error.code === GITHUB_NOT_CONNECTED_CODE) return ESigningKeyOutcome.GithubNotConnected
  if (args.error.status === CONFLICT_STATUS) return args.conflict
  return ESigningKeyOutcome.Unavailable
}

export const ensureSigningKey = async (args: {
  client: SigningKeyClient
  comment: string
}): Promise<ESigningKeyOutcome> => {
  try {
    const status = await args.client.status()
    if (status.state === ESshSigningKeyState.Registered) return ESigningKeyOutcome.AlreadyRegistered
    await args.client.register({
      privateKey: generateSigningKeyPair({ comment: args.comment }).privateKey,
    })
    return ESigningKeyOutcome.Registered
  } catch (error) {
    return outcomeOfFailure({ error, conflict: ESigningKeyOutcome.AlreadyRegistered })
  }
}

export const rotateSigningKey = async (args: {
  client: SigningKeyClient
  comment: string
}): Promise<ESigningKeyOutcome> => {
  try {
    await args.client.rotate({
      privateKey: generateSigningKeyPair({ comment: args.comment }).privateKey,
    })
    return ESigningKeyOutcome.Rotated
  } catch (error) {
    return outcomeOfFailure({ error, conflict: ESigningKeyOutcome.Unavailable })
  }
}

export const removeSigningKey = async (args: {
  client: SigningKeyClient
}): Promise<ESigningKeyOutcome> => {
  try {
    await args.client.revoke()
    return ESigningKeyOutcome.Removed
  } catch (error) {
    return outcomeOfFailure({ error, conflict: ESigningKeyOutcome.Unavailable })
  }
}
