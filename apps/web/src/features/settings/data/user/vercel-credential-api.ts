import { USER_VERCEL_CREDENTIAL_PATH } from '@dltech/atlas-wire/web'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import {
  vercelCredentialSchema,
  viewOfCredential,
  type VercelCredentialView,
  type VercelUpsertBody,
} from '../workspace/vercel-credential'

export async function getUserVercelCredential(): Promise<VercelCredentialView> {
  const wire = await cloudJson({
    method: EHttpMethod.Get,
    path: USER_VERCEL_CREDENTIAL_PATH,
    schema: vercelCredentialSchema,
  })
  return viewOfCredential(wire)
}

export const putUserVercelCredential = (body: VercelUpsertBody) =>
  cloudSend({ method: EHttpMethod.Put, path: USER_VERCEL_CREDENTIAL_PATH, body })

export const deleteUserVercelCredential = () =>
  cloudSend({ method: EHttpMethod.Delete, path: USER_VERCEL_CREDENTIAL_PATH })
