'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  deleteVercelCredential,
  getVercelCredential,
  putVercelCredential,
} from './vercel-credential-api'
import type { VercelCredentialView, VercelUpsertBody } from './vercel-credential'

export type VercelSnapshot = { view: VercelCredentialView; fetchedAt: number }

export type VercelCredentialResource = {
  query: CloudQuery<VercelSnapshot>
  save: (body: VercelUpsertBody) => Promise<void>
  remove: () => Promise<void>
}

export function useVercelCredential(organizationId: string): VercelCredentialResource {
  const load = useCallback(
    async (): Promise<VercelSnapshot> => ({
      view: await getVercelCredential(organizationId),
      fetchedAt: Date.now(),
    }),
    [organizationId],
  )
  const query = useCloudQuery({ key: `vercel-credential:${organizationId}`, load })
  const { reload } = query
  const save = useCallback(
    async (body: VercelUpsertBody) => {
      await putVercelCredential({ organizationId, body })
      reload()
    },
    [organizationId, reload],
  )
  const remove = useCallback(async () => {
    await deleteVercelCredential(organizationId)
    reload()
  }, [organizationId, reload])
  return { query, save, remove }
}
