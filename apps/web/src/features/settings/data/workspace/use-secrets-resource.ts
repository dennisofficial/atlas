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

export function useSecretsResource(base: string): SecretsResource {
  const load = useCallback(
    async (): Promise<SecretsSnapshot> => ({ secrets: await listSecrets(base), fetchedAt: Date.now() }),
    [base],
  )
  const query = useCloudQuery({ key: `secrets:${base}`, load })
  const { reload } = query
  const save = useCallback(
    async (args: { name: string; value: string; kind: ESecretKind }) => {
      await putSecret({ base, ...args })
      reload()
    },
    [base, reload],
  )
  const remove = useCallback(
    async (name: string) => {
      await deleteSecret({ base, name })
      reload()
    },
    [base, reload],
  )
  return { query, save, remove }
}
