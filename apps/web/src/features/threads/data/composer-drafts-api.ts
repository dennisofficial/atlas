import { COMPOSER_DRAFT_NEW_THREAD_SCOPE } from '@dltech/atlas-wire/web'
import type { SaidUpload } from '@dltech/atlas-core'

import { api, cloudCall } from '@/lib/api-client'

export const NEW_THREAD_DRAFT_SCOPE = COMPOSER_DRAFT_NEW_THREAD_SCOPE

export type StoredDraft = { text: string; uploads: SaidUpload[] }

export async function fetchDraft(scope: string): Promise<StoredDraft | null> {
  const { draft } = await cloudCall(api.composerDrafts.get.query({ scope }))
  return draft === null ? null : { text: draft.text, uploads: draft.uploads }
}

export const putDraft = (args: {
  scope: string
  text: string
  uploads: readonly SaidUpload[]
}): Promise<unknown> =>
  cloudCall(
    api.composerDrafts.put.mutate({
      scope: args.scope,
      text: args.text,
      uploads: [...args.uploads],
    }),
  )

export const clearDraft = (scope: string): Promise<unknown> =>
  cloudCall(api.composerDrafts.clear.mutate({ scope }))
