import { z } from 'zod'

import { changeFileStatusSchema, changeSideSchema } from '../changes-state'
import { okResultSchema } from './result'

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const repoPathSchema = z.string().min(1)
const baseSchema = z.string().min(1).nullable()
const pathSchema = z.string().min(1)

export const changePathEntrySchema = z
  .object({
    path: pathSchema,
    oldPath: pathSchema.nullable(),
    status: changeFileStatusSchema,
    additions: z.number().int().min(0),
    deletions: z.number().int().min(0),
    binary: z.boolean(),
    baseHash: hashSchema.nullable(),
    currentHash: hashSchema.nullable(),
    baseSize: z.number().int().min(0).nullable(),
    currentSize: z.number().int().min(0).nullable(),
  })
  .strict()

export const changesScanOpSchema = z
  .object({ op: z.literal('changes.scan'), repoPath: repoPathSchema, base: baseSchema })
  .strict()

export const changesReadOpSchema = z
  .object({
    op: z.literal('changes.read'),
    repoPath: repoPathSchema,
    base: baseSchema,
    path: pathSchema,
    oldPath: pathSchema.nullable(),
    side: changeSideSchema,
  })
  .strict()

export const changesOpSchemas = [changesScanOpSchema, changesReadOpSchema] as const

export const changesManifestSchema = z
  .object({
    repoPath: repoPathSchema,
    base: baseSchema,
    files: z.array(changePathEntrySchema),
  })
  .strict()

export const changesContentSchema = z
  .object({ hash: hashSchema, size: z.number().int().min(0), base64: z.string() })
  .strict()

export const changesResultSchemas = [
  okResultSchema({ op: 'changes.scan', value: changesManifestSchema }),
  okResultSchema({ op: 'changes.read', value: changesContentSchema }),
] as const

export type ChangePathEntry = z.infer<typeof changePathEntrySchema>
export type ChangesScanOp = z.infer<typeof changesScanOpSchema>
export type ChangesReadOp = z.infer<typeof changesReadOpSchema>
export type ChangesManifest = z.infer<typeof changesManifestSchema>
export type ChangesContent = z.infer<typeof changesContentSchema>
