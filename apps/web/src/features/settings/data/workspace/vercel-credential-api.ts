import { api, cloudCall } from '@/lib/api-client'

import {
  viewOfCredential,
  type VercelCredentialView,
  type VercelUpsertBody,
} from './vercel-credential'

export async function getVercelCredential(organizationId: string): Promise<VercelCredentialView> {
  return viewOfCredential(await cloudCall(api.workspaces.getVercel.query({ organizationId })))
}

export const putVercelCredential = (args: { organizationId: string; body: VercelUpsertBody }) =>
  cloudCall(api.workspaces.saveVercel.mutate({ organizationId: args.organizationId, ...args.body }))

export const deleteVercelCredential = (organizationId: string) =>
  cloudCall(api.workspaces.removeVercel.mutate({ organizationId }))
