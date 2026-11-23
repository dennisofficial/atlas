import { z } from 'zod'
import { EContextFileKind } from '@dltech/atlas-core'

export const contextMirrorListInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})
export type ContextMirrorListInput = z.infer<typeof contextMirrorListInputSchema>

export const contextMirrorEntrySchema = z.strictObject({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  mime: z.string().min(1),
  kind: z.enum(EContextFileKind),
  mtimeMs: z.number().nonnegative(),
  mirrored: z.boolean(),
})
export type ContextMirrorEntry = z.infer<typeof contextMirrorEntrySchema>

export const contextMirrorListOutputSchema = z.strictObject({
  files: z.array(contextMirrorEntrySchema),
})
export type ContextMirrorListOutput = z.infer<typeof contextMirrorListOutputSchema>

export const contextMirrorReadInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  path: z.string().min(1),
})
export type ContextMirrorReadInput = z.infer<typeof contextMirrorReadInputSchema>

export const contextMirrorFileSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    path: z.string().min(1),
    content: z.string(),
    truncated: z.boolean(),
    bytes: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('image'),
    path: z.string().min(1),
    mime: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    url: z.string(),
  }),
  z.strictObject({
    type: z.literal('binary'),
    path: z.string().min(1),
    mime: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    url: z.string(),
  }),
  z.strictObject({
    type: z.literal('refused'),
    path: z.string().min(1),
    reason: z.string().min(1),
  }),
])
export type ContextMirrorFile = z.infer<typeof contextMirrorFileSchema>

export const contextMirrorReadOutputSchema = z.strictObject({ file: contextMirrorFileSchema })
export type ContextMirrorReadOutput = z.infer<typeof contextMirrorReadOutputSchema>
