import {
  vercelCredentialSchema,
  type VercelCredentialUpsert,
  type VercelCredentialView as VercelCredentialWire,
} from '@dltech/atlas-wire/web'

import { relativeTimeOf } from './relative-time'

export { vercelCredentialSchema, type VercelCredentialWire }

export type VercelCredentialView = {
  configured: boolean
  teamId: string
  vercelProjectId: string
  updatedAt: string | null
}

export type VercelDraft = { teamId: string; vercelProjectId: string; token: string }

export type VercelUpsertBody = VercelCredentialUpsert

export const NOT_CONFIGURED_STATUS = 'Not configured'
export const TEAM_ID_REQUIRED = 'A Vercel team ID is required'
export const PROJECT_ID_REQUIRED = 'A Vercel project ID is required'
export const NEEDS_PROJECT_ID_STATUS = 'Needs a Vercel project ID'
export const TOKEN_REQUIRED = 'A Vercel token is required the first time'

export const viewOfCredential = (wire: VercelCredentialWire): VercelCredentialView => ({
  configured: wire.configured,
  teamId: wire.teamId ?? '',
  vercelProjectId: wire.vercelProjectId ?? '',
  updatedAt: wire.updatedAt,
})

export function statusLineOf({ view, now }: { view: VercelCredentialView; now: number }): string {
  if (!view.configured) return NOT_CONFIGURED_STATUS
  if (view.vercelProjectId === '') return NEEDS_PROJECT_ID_STATUS
  if (view.updatedAt === null) return 'Configured'
  return `Configured · updated ${relativeTimeOf({ iso: view.updatedAt, now })}`
}

export function requestBodyOf(draft: VercelDraft): VercelUpsertBody {
  const teamId = draft.teamId.trim()
  const vercelProjectId = draft.vercelProjectId.trim()
  const token = draft.token.trim()
  return token === '' ? { teamId, vercelProjectId } : { teamId, vercelProjectId, token }
}

export const isVercelDraftDirty = ({
  view,
  draft,
}: {
  view: VercelCredentialView
  draft: VercelDraft
}): boolean =>
  draft.teamId.trim() !== view.teamId ||
  draft.vercelProjectId.trim() !== view.vercelProjectId ||
  draft.token.trim() !== ''

export function validateVercelDraft({
  view,
  draft,
}: {
  view: VercelCredentialView
  draft: VercelDraft
}): string | null {
  if (draft.teamId.trim() === '') return TEAM_ID_REQUIRED
  if (draft.vercelProjectId.trim() === '') return PROJECT_ID_REQUIRED
  if (!view.configured && draft.token.trim() === '') return TOKEN_REQUIRED
  return null
}

export const canSaveVercelDraft = ({
  view,
  draft,
}: {
  view: VercelCredentialView
  draft: VercelDraft
}): boolean => isVercelDraftDirty({ view, draft }) && validateVercelDraft({ view, draft }) === null
