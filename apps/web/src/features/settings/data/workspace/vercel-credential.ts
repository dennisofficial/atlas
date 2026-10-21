import { z } from 'zod'

import { relativeTimeOf } from './relative-time'

export const vercelCredentialSchema = z.object({
  configured: z.boolean(),
  teamId: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type VercelCredentialWire = z.infer<typeof vercelCredentialSchema>

export type VercelCredentialView = {
  configured: boolean
  teamId: string
  updatedAt: string | null
}

export type VercelDraft = { teamId: string; token: string }

export type VercelUpsertBody = { teamId: string; token?: string }

export const NOT_CONFIGURED_STATUS = 'Not configured'
export const TEAM_ID_REQUIRED = 'A Vercel team ID is required'
export const TOKEN_REQUIRED = 'A Vercel token is required the first time'

export const viewOfCredential = (wire: VercelCredentialWire): VercelCredentialView => ({
  configured: wire.configured,
  teamId: wire.teamId ?? '',
  updatedAt: wire.updatedAt,
})

export function statusLineOf({ view, now }: { view: VercelCredentialView; now: number }): string {
  if (!view.configured) return NOT_CONFIGURED_STATUS
  if (view.updatedAt === null) return 'Configured'
  return `Configured · updated ${relativeTimeOf({ iso: view.updatedAt, now })}`
}

export function requestBodyOf(draft: VercelDraft): VercelUpsertBody {
  const teamId = draft.teamId.trim()
  const token = draft.token.trim()
  return token === '' ? { teamId } : { teamId, token }
}

export const isVercelDraftDirty = ({
  view,
  draft,
}: {
  view: VercelCredentialView
  draft: VercelDraft
}): boolean => draft.teamId.trim() !== view.teamId || draft.token.trim() !== ''

export function validateVercelDraft({
  view,
  draft,
}: {
  view: VercelCredentialView
  draft: VercelDraft
}): string | null {
  if (draft.teamId.trim() === '') return TEAM_ID_REQUIRED
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
