import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import { workspaceBase } from './resource-api'
import {
  vercelCredentialSchema,
  viewOfCredential,
  type VercelCredentialView,
  type VercelUpsertBody,
} from './vercel-credential'

const vercelPath = (organizationId: string) => `${workspaceBase(organizationId)}/vercel`

export async function getVercelCredential(organizationId: string): Promise<VercelCredentialView> {
  const wire = await cloudJson({
    method: EHttpMethod.Get,
    path: vercelPath(organizationId),
    schema: vercelCredentialSchema,
  })
  return viewOfCredential(wire)
}

export const putVercelCredential = (args: { organizationId: string; body: VercelUpsertBody }) =>
  cloudSend({ method: EHttpMethod.Put, path: vercelPath(args.organizationId), body: args.body })

export const deleteVercelCredential = (organizationId: string) =>
  cloudSend({ method: EHttpMethod.Delete, path: vercelPath(organizationId) })
