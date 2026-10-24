'use client'

import { useCallback } from 'react'

import type { ESecretKind } from '@dltech/atlas-wire/web'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  deleteSecret,
  listSecrets,
  ownerKeyOf,
  putSecret,
  type ListedSecret,
  type ResourceOwner,
} from './resource-api'

export type SecretsSnapshot = { secrets: ListedSecret[]; fetchedAt: number }

export type SecretsResource = {
  query: CloudQuery<SecretsSnapshot>
  save: (args: { name: string; value: string; kind: ESecretKind }) => Promise<void>
  remove: (name: string) => Promise<void>
}

export function useSecretsResource(owner: ResourceOwner): SecretsResource {
  const ownerKey = ownerKeyOf(owner)
  const load = useCallback(
    async (): Promise<SecretsSnapshot> => ({
      secrets: await listSecrets(owner),
      fetchedAt: Date.now(),
    }),
    [ownerKey],
  )
  const query = useCloudQuery({ key: `secrets:${ownerKey}`, load })
  const { reload } = query
  const save = useCallback(
    async (args: { name: string; value: string; kind: ESecretKind }) => {
      await putSecret({ owner, ...args })
      reload()
    },
    [ownerKey, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await deleteSecret({ owner, name })
      reload()
    },
    [ownerKey, reload],
  )
  return { query, save, remove }
}
