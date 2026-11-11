import { z } from 'zod'

import { okResultSchema } from './result'

export const statOpSchema = z.object({ op: z.literal('stat'), path: z.string().min(1) }).strict()

export const readLinkOpSchema = z
  .object({ op: z.literal('readLink'), path: z.string().min(1) })
  .strict()

export const readFileOpSchema = z
  .object({ op: z.literal('readFile'), path: z.string().min(1) })
  .strict()

export const readBytesOpSchema = z
  .object({ op: z.literal('readBytes'), path: z.string().min(1) })
  .strict()

export const readTextForEditOpSchema = z
  .object({ op: z.literal('readTextForEdit'), path: z.string().min(1) })
  .strict()

export const writeFileOpSchema = z
  .object({
    op: z.literal('writeFile'),
    path: z.string().min(1),
    content: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    mode: z.number().int().min(0).max(0o777).optional(),
  })
  .strict()

export const removeOpSchema = z
  .object({ op: z.literal('remove'), path: z.string().min(1) })
  .strict()

export const mkdirOpSchema = z.object({ op: z.literal('mkdir'), path: z.string().min(1) }).strict()

export const renameOpSchema = z
  .object({
    op: z.literal('rename'),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict()

export const fetchToFileOpSchema = z
  .object({
    op: z.literal('fetchToFile'),
    url: z.url(),
    path: z.string().min(1),
    size: z.number().int().min(0),
  })
  .strict()

export const readDirectoryOpSchema = z
  .object({ op: z.literal('readDirectory'), path: z.string().min(1) })
  .strict()

export const globOpSchema = z
  .object({
    op: z.literal('glob'),
    pattern: z.string().min(1),
    cwd: z.string().min(1),
    dot: z.boolean().optional(),
  })
  .strict()

export const grepOpSchema = z
  .object({
    op: z.literal('grep'),
    pattern: z.string().min(1),
    path: z.string().min(1),
    glob: z.string().min(1).optional(),
    caseInsensitive: z.boolean().optional(),
    maxResults: z.number().int().min(1).optional(),
  })
  .strict()

export const statResultSchema = z.object({
  size: z.number().int().min(0),
  mode: z.number().int().min(0),
  mtimeMs: z.number(),
  isFile: z.boolean(),
  isDirectory: z.boolean(),
})

export const readTextForEditResultSchema = z.object({
  text: z.string(),
  strict: z.string().nullable(),
})

export const directoryEntrySchema = z.object({
  name: z.string(),
  isFile: z.boolean(),
  isDirectory: z.boolean(),
})

export const grepMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().min(1),
  column: z.number().int().min(1).optional(),
  text: z.string(),
})

export const filesOpSchemas = [
  statOpSchema,
  readLinkOpSchema,
  readFileOpSchema,
  readBytesOpSchema,
  readTextForEditOpSchema,
  writeFileOpSchema,
  removeOpSchema,
  mkdirOpSchema,
  renameOpSchema,
  fetchToFileOpSchema,
  readDirectoryOpSchema,
  globOpSchema,
  grepOpSchema,
] as const

export const filesResultSchemas = [
  okResultSchema({ op: 'stat', value: statResultSchema }),
  okResultSchema({ op: 'readLink', value: z.string().nullable() }),
  okResultSchema({ op: 'readFile', value: z.string() }),
  okResultSchema({ op: 'readBytes', value: z.base64() }),
  okResultSchema({ op: 'readTextForEdit', value: readTextForEditResultSchema }),
  okResultSchema({ op: 'writeFile', value: z.null() }),
  okResultSchema({ op: 'remove', value: z.null() }),
  okResultSchema({ op: 'mkdir', value: z.null() }),
  okResultSchema({ op: 'rename', value: z.null() }),
  okResultSchema({ op: 'fetchToFile', value: z.null() }),
  okResultSchema({ op: 'readDirectory', value: z.array(directoryEntrySchema) }),
  okResultSchema({ op: 'glob', value: z.array(z.string()) }),
  okResultSchema({ op: 'grep', value: z.array(grepMatchSchema) }),
] as const

export const filesEventSchemas = [] as const

export type StatOp = z.infer<typeof statOpSchema>
export type ReadLinkOp = z.infer<typeof readLinkOpSchema>
export type ReadFileOp = z.infer<typeof readFileOpSchema>
export type ReadBytesOp = z.infer<typeof readBytesOpSchema>
export type ReadTextForEditOp = z.infer<typeof readTextForEditOpSchema>
export type WriteFileOp = z.infer<typeof writeFileOpSchema>
export type RemoveOp = z.infer<typeof removeOpSchema>
export type MkdirOp = z.infer<typeof mkdirOpSchema>
export type RenameOp = z.infer<typeof renameOpSchema>
export type FetchToFileOp = z.infer<typeof fetchToFileOpSchema>
export type ReadDirectoryOp = z.infer<typeof readDirectoryOpSchema>
export type GlobOp = z.infer<typeof globOpSchema>
export type GrepOp = z.infer<typeof grepOpSchema>
export type StatResult = z.infer<typeof statResultSchema>
export type ReadTextForEditResult = z.infer<typeof readTextForEditResultSchema>
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>
export type GrepMatch = z.infer<typeof grepMatchSchema>
