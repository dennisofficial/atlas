import { z } from 'zod'

export const fileContentSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    path: z.string(),
    content: z.string(),
    truncated: z.boolean(),
    bytes: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal('refused'), path: z.string(), reason: z.string() }),
])
export type FileContent = z.infer<typeof fileContentSchema>

export const filesTreeInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  directory: z.string(),
  checkoutId: z.string().min(1).optional(),
})
export const filesTreeEntrySchema = z.strictObject({
  name: z.string(),
  isDirectory: z.boolean(),
  changed: z.boolean(),
})
export type FilesTreeInput = z.infer<typeof filesTreeInputSchema>
export const filesTreeOutputSchema = z.strictObject({
  directory: z.string(),
  entries: z.array(filesTreeEntrySchema),
})
export type FilesTreeOutput = z.infer<typeof filesTreeOutputSchema>

export const filesSearchInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  query: z.string().min(1).max(200),
  checkoutId: z.string().min(1).optional(),
})
export type FilesSearchInput = z.infer<typeof filesSearchInputSchema>
export const filesSearchOutputSchema = z.strictObject({
  paths: z.array(z.strictObject({ path: z.string(), positions: z.array(z.number().int().min(0)) })),
  truncated: z.boolean(),
})
export type FilesSearchOutput = z.infer<typeof filesSearchOutputSchema>

export const filesReadInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  path: z.string().min(1),
  checkoutId: z.string().min(1).optional(),
})
export type FilesReadInput = z.infer<typeof filesReadInputSchema>
export const filesReadOutputSchema = z.strictObject({ file: fileContentSchema })
export type FilesReadOutput = z.infer<typeof filesReadOutputSchema>
