'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import type { AccessGrant, AccessGrantSave, AccessScope } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { fileMountsQueryKeyOf, scopeKeyOf, secretsQueryKeyOf } from './access-grant-helpers'

export type AccessGrantsSnapshot = { grants: AccessGrant[] }

export type AccessGrantDraft = {
  id?: string
  name: string
  instruction: string
  secretNames: string[]
  filePaths: string[]
}

export type AccessGrantsResource = {
  query: CloudQuery<AccessGrantsSnapshot>
  save: (draft: AccessGrantDraft) => Promise<void>
  remove: (id: string) => Promise<void>
}

export async function listAccessGrants(scope: AccessScope): Promise<AccessGrant[]> {
  const body = await cloudCall(api.accessGrants.list.query({ scope }))
  return body.grants
}

const saveBodyOf = (args: { scope: AccessScope; draft: AccessGrantDraft }): AccessGrantSave => ({
  scope: args.scope,
  name: args.draft.name,
  instruction: args.draft.instruction,
  secretNames: args.draft.secretNames,
  filePaths: args.draft.filePaths,
  ...(args.draft.id === undefined ? {} : { id: args.draft.id }),
})

export function useAccessGrants(scope: AccessScope): AccessGrantsResource {
  const client = useQueryClient()
  const load = useCallback(
    async (): Promise<AccessGrantsSnapshot> => ({ grants: await listAccessGrants(scope) }),
    [scope],
  )
  const query = useCloudQuery({ key: `access-grants:${scopeKeyOf(scope)}`, load })
  const { reload } = query
  const invalidateMembers = useCallback(async () => {
    await client.invalidateQueries({ queryKey: [secretsQueryKeyOf(scope)] })
    const mountsKey = fileMountsQueryKeyOf(scope)
    if (mountsKey !== null) await client.invalidateQueries({ queryKey: [mountsKey] })
  }, [client, scope])
  const save = useCallback(
    async (draft: AccessGrantDraft) => {
      await cloudCall(api.accessGrants.save.mutate(saveBodyOf({ scope, draft })))
      reload()
      await invalidateMembers()
    },
    [invalidateMembers, reload, scope],
  )
  const remove = useCallback(
    async (id: string) => {
      await cloudCall(api.accessGrants.remove.mutate({ scope, id }))
      reload()
      await invalidateMembers()
    },
    [invalidateMembers, reload, scope],
  )
  return { query, save, remove }
}
