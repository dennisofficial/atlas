import { api, cloudCall } from '@/lib/api-client'

import {
  viewOfCredential,
  type VercelCredentialView,
  type VercelUpsertBody,
} from '../workspace/vercel-credential'

export async function getUserVercelCredential(): Promise<VercelCredentialView> {
  const wire = await cloudCall(api.userVercel.get.query())
  return viewOfCredential(wire)
}

export const putUserVercelCredential = (body: VercelUpsertBody) =>
  cloudCall(api.userVercel.save.mutate(body))

export const deleteUserVercelCredential = () => cloudCall(api.userVercel.remove.mutate())
