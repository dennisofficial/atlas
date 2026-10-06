import { ENoAccountReason, providerSpec, type EAuthProvider, type StoredAccount } from '@dltech/atlas-core'

import { CloudError, isCloudUnavailable } from '../cloud/cloud-transport'
import { CredentialError, ECredentialFailure } from './credential-error'

const REAUTHORIZE = 'Sign in with /auth.'

export const isTransient = (error: unknown): boolean =>
  isCloudUnavailable(error) || (error instanceof CloudError && error.status === 429)

const refused = (message: string): CredentialError =>
  new CredentialError({ failure: ECredentialFailure.Expired, message })

export const credentialErrorOf = (error: unknown): CredentialError => {
  if (error instanceof CredentialError) return error
  if (!(error instanceof CloudError)) {
    return new CredentialError({
      failure: ECredentialFailure.RefreshFailed,
      message: `The Atlas Cloud OAuth request failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    })
  }

  if (isTransient(error)) {
    return new CredentialError({
      failure: ECredentialFailure.StoreUnavailable,
      message: `Atlas Cloud could not be reached to renew the OAuth login, and no unexpired access token is cached: ${error.message}`,
    })
  }
  if (error.status === 401)
    return refused('Atlas Cloud rejected this session, so the OAuth login cannot be renewed. Sign back in to Atlas Cloud with /auth.')
  if (error.status === 403)
    return refused('Atlas Cloud did not authorize this session or sandbox to use that OAuth connection.')
  if (error.status === 404)
    return refused(`Atlas Cloud holds no such OAuth connection. ${REAUTHORIZE}`)

  return new CredentialError({ failure: ECredentialFailure.RefreshFailed, message: error.message })
}

export const expired = (stored: StoredAccount): CredentialError =>
  new CredentialError({
    failure: ECredentialFailure.Expired,
    message: `The ${providerSpec(stored.provider).label} login for ${stored.label} is not managed by Atlas Cloud. ${REAUTHORIZE}`,
  })

export const signInToCloud = (stored: StoredAccount): CredentialError =>
  new CredentialError({
    failure: ECredentialFailure.Expired,
    message: `The ${providerSpec(stored.provider).label} login for ${stored.label} is owned by Atlas Cloud and its cached access has expired. Sign back in to Atlas Cloud with /auth to renew it.`,
  })

export const otherAuthority = (stored: StoredAccount): CredentialError =>
  new CredentialError({
    failure: ECredentialFailure.Unsupported,
    message: `The ${stored.label} login is owned by a different Atlas Cloud API than the one you are signed in to. Sign in to that API, or sign in to ${providerSpec(stored.provider).label} again with /auth.`,
  })

export const changedUnderneath = (stored: StoredAccount): CredentialError =>
  new CredentialError({
    failure: ECredentialFailure.StoreUnavailable,
    message: `The ${stored.label} login changed while Atlas Cloud was renewing it. Retry.`,
  })

export const noAccount = (provider: EAuthProvider, reason: ENoAccountReason): CredentialError => {
  const label = providerSpec(provider).label
  const detail =
    reason === ENoAccountReason.NoneAtAll ? 'Atlas holds no accounts.' : `Atlas holds no ${label} account.`

  return new CredentialError({ failure: ECredentialFailure.NotFound, message: `${detail} ${REAUTHORIZE}` })
}
