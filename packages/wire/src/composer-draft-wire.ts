import { z } from 'zod'

import { saidUploadWireSchema } from './upload-wire'

export const COMPOSER_DRAFT_NEW_THREAD_SCOPE = 'new'

export const composerDraftScopeSchema = z.string().min(1).max(200)

export const composerDraftPutInputSchema = z.strictObject({
  scope: composerDraftScopeSchema,
  text: z.string().max(100_000),
  uploads: z.array(saidUploadWireSchema).max(20),
})
export type ComposerDraftPutInput = z.infer<typeof composerDraftPutInputSchema>

export const composerDraftGetInputSchema = z.strictObject({ scope: composerDraftScopeSchema })
export type ComposerDraftGetInput = z.infer<typeof composerDraftGetInputSchema>

export const composerDraftSchema = z.object({
  scope: composerDraftScopeSchema,
  text: z.string(),
  uploads: z.array(saidUploadWireSchema),
  updatedAt: z.iso.datetime(),
})
export type ComposerDraft = z.infer<typeof composerDraftSchema>

export const composerDraftGetReplySchema = z.object({
  draft: composerDraftSchema.nullable(),
})
export type ComposerDraftGetReply = z.infer<typeof composerDraftGetReplySchema>

export const composerDraftClearInputSchema = z.strictObject({ scope: composerDraftScopeSchema })
export type ComposerDraftClearInput = z.infer<typeof composerDraftClearInputSchema>
