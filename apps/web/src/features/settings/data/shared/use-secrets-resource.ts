'use client'

import { useCallback } from 'react'

import type { ESecretKind } from '@dltech/atlas-wire/web'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { deleteSecret, listSecrets, putSecret, type ListedSecret } from './resource-api'

export type SecretsSnapshot = { secrets: ListedSecret[]; fetchedAt: number }

export type SecretsResource = {
  query: CloudQuery<SecretsSnapshot>
  save: (args: { name: string; value: string; kind: ESecretKind }) => Promise<void>
  remove: (name: string) => Promise<void>
}

export function useSecretsResource(projectId: string): SecretsResource {
  const load = useCallback(
    async (): Promise<SecretsSnapshot> => ({
      secrets: await listSecrets(projectId),
      fetchedAt: Date.now(),
    }),
    [projectId],
  )
  const query = useCloudQuery({ key: `secrets:${projectId}`, load })
  const { reload } = query
  const save = useCallback(
    async (args: { name: string; value: string; kind: ESecretKind }) => {
      await putSecret({ projectId, ...args })
      reload()
    },
    [projectId, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await deleteSecret({ projectId, name })
      reload()
    },
    [projectId, reload],
  )
  return { query, save, remove }
}
