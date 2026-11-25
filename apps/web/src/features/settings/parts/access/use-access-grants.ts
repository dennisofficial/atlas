'use client'

import { useCallback, useMemo } from 'react'

import type {
  AccessGrant,
  AccessGrantMember,
  AccessGrantSave,
  AccessScope,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import type { AccessMemberApi } from './access-members-api'
import { scopeKeyOf } from './access-grant-helpers'

export type AccessGrantsSnapshot = { grants: AccessGrant[]; fetchedAt: number }

export type AccessGrantDraft = {
  id?: string
  name: string
  instruction: string
}

export type AccessGrantsActions = AccessMemberApi & {
  save: (draft: AccessGrantDraft) => Promise<void>
  remove: (id: string) => Promise<void>
  moveMember: (args: { member: AccessGrantMember; grantId: string }) => Promise<void>
}

export type AccessGrantsResource = {
  query: CloudQuery<AccessGrantsSnapshot>
  actions: AccessGrantsActions
}

export async function listAccessGrants(scope: AccessScope): Promise<AccessGrant[]> {
  const body = await cloudCall(api.accessGrants.list.query({ scope }))
  return body.grants
}

const saveBodyOf = (args: { scope: AccessScope; draft: AccessGrantDraft }): AccessGrantSave => ({
  scope: args.scope,
  name: args.draft.name,
  instruction: args.draft.instruction,
  ...(args.draft.id === undefined ? {} : { id: args.draft.id }),
})

export function useAccessGrants({
  scope,
  members,
}: {
  scope: AccessScope
  members: AccessMemberApi
}): AccessGrantsResource {
  const load = useCallback(
    async (): Promise<AccessGrantsSnapshot> => ({
      grants: await listAccessGrants(scope),
      fetchedAt: Date.now(),
    }),
    [scope],
  )
  const query = useCloudQuery({ key: `access-grants:${scopeKeyOf(scope)}`, load })
  const { reload } = query
  const actions = useMemo((): AccessGrantsActions => {
    const write = async (work: () => Promise<void>): Promise<void> => {
      await work()
      reload()
    }
    return {
      ...members,
      save: async (draft) => {
        await cloudCall(api.accessGrants.save.mutate(saveBodyOf({ scope, draft })))
        reload()
      },
      remove: (id) => write(() => cloudCall(api.accessGrants.remove.mutate({ scope, id }))),
      moveMember: (args) =>
        write(() =>
          cloudCall(
            api.accessGrants.moveMember.mutate({
              scope,
              grantId: args.grantId,
              member: args.member,
            }),
          ),
        ),
      setSecret: (args) => write(() => members.setSecret(args)),
      removeSecret: (name) => write(() => members.removeSecret(name)),
      setFile: (args) => write(() => members.setFile(args)),
      removeFile: (path) => write(() => members.removeFile(path)),
    }
  }, [members, reload, scope])
  return { query, actions }
}
