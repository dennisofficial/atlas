import { attachmentSchema, EAttachmentStore, MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'
import { z } from 'zod'

const storedAttachmentSchema = attachmentSchema.refine(
  (attachment) => attachment.content.store !== EAttachmentStore.Inline,
  'a draft attachment is an upload or stored media',
)

const sessionDraftScopeSchema = z.string().min(1).max(200).nullable()

const sessionDraftScopeFields = { sessionId: sessionDraftScopeSchema }

export const sessionDraftPutInputSchema = z.strictObject({
  ...sessionDraftScopeFields,
  text: z.string().max(1_000_000),
  attachments: z.array(storedAttachmentSchema).max(MAX_MESSAGE_UPLOADS),
})
export type SessionDraftPutInput = z.infer<typeof sessionDraftPutInputSchema>

export const sessionDraftGetInputSchema = z.strictObject(sessionDraftScopeFields)
export type SessionDraftGetInput = z.infer<typeof sessionDraftGetInputSchema>

export const sessionDraftClearInputSchema = z.strictObject(sessionDraftScopeFields)
export type SessionDraftClearInput = z.infer<typeof sessionDraftClearInputSchema>

export const sessionDraftSchema = z.strictObject({
  ...sessionDraftScopeFields,
  text: z.string().max(1_000_000),
  attachments: z.array(attachmentSchema).max(MAX_MESSAGE_UPLOADS),
  updatedAt: z.iso.datetime(),
})
export type SessionDraft = z.infer<typeof sessionDraftSchema>

export const sessionDraftGetOutputSchema = z.strictObject({
  draft: sessionDraftSchema.nullable(),
})
export type SessionDraftGetOutput = z.infer<typeof sessionDraftGetOutputSchema>

export const sessionDraftClearOutputSchema = z.strictObject({ ok: z.literal(true) })
export type SessionDraftClearOutput = z.infer<typeof sessionDraftClearOutputSchema>
