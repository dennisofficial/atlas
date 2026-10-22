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

export type VercelCredentialSource = {
  key: string
  load: () => Promise<VercelCredentialView>
  put: (body: VercelUpsertBody) => Promise<void>
  remove: () => Promise<void>
}

export function useVercelCredentialSource(
  source: VercelCredentialSource,
): VercelCredentialResource {
  const { key, load: loadView, put, remove: removeCredential } = source
  const load = useCallback(
    async (): Promise<VercelSnapshot> => ({ view: await loadView(), fetchedAt: Date.now() }),
    [loadView],
  )
  const query = useCloudQuery({ key, load })
  const { reload } = query
  const save = useCallback(
    async (body: VercelUpsertBody) => {
      await put(body)
      reload()
    },
    [put, reload],
  )
  const remove = useCallback(async () => {
    await removeCredential()
    reload()
  }, [removeCredential, reload])
  return { query, save, remove }
}

export function useVercelCredential(organizationId: string): VercelCredentialResource {
  const load = useCallback(() => getVercelCredential(organizationId), [organizationId])
  const put = useCallback(
    (body: VercelUpsertBody) => putVercelCredential({ organizationId, body }),
    [organizationId],
  )
  const remove = useCallback(() => deleteVercelCredential(organizationId), [organizationId])
  return useVercelCredentialSource({
    key: `vercel-credential:${organizationId}`,
    load,
    put,
    remove,
  })
}
