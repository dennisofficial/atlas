import { z } from 'zod'

import { projectIdInputSchema } from '../project-wire'

export const HOME_MOUNT_PREFIX = '~/'
export const MAX_FILE_MOUNT_BYTES = 64 * 1024
export const MAX_FILE_MOUNT_PATH_LENGTH = 500
export const DEFAULT_FILE_MOUNT_MODE = 0o600
const MAX_FILE_MODE = 0o777

export enum EFileMountTarget {
  Repository = 'repository',
  Home = 'home',
}

export enum ERepoTreeEntryKind {
  File = 'file',
  Folder = 'folder',
}

export const fileMountTargetOf = (path: string): EFileMountTarget =>
  path.startsWith(HOME_MOUNT_PREFIX) ? EFileMountTarget.Home : EFileMountTarget.Repository

export const fileMountRelativePathOf = (path: string): string =>
  fileMountTargetOf(path) === EFileMountTarget.Home ? path.slice(HOME_MOUNT_PREFIX.length) : path

export const fileMountPathProblem = (path: string): string | null => {
  const relative = fileMountRelativePathOf(path)
  if (relative.length === 0) return 'Enter a file path'
  if (relative.startsWith('/')) return 'Use a path relative to the repository, or start it with ~/'
  if (relative.includes('\\')) return 'Use / to separate folders'
  const segments = relative.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'Remove empty, . and .. folders from the path'
  }
  const isRepository = fileMountTargetOf(path) === EFileMountTarget.Repository
  if (isRepository && segments[0] === '.git') return 'Atlas cannot write inside .git'
  return null
}

export const fileMountPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_FILE_MOUNT_PATH_LENGTH)
  .superRefine((path, context) => {
    const problem = fileMountPathProblem(path)
    if (problem !== null) context.addIssue({ code: 'custom', message: problem })
  })

export const fileMountContentsSchema = z
  .string()
  .refine((contents) => new TextEncoder().encode(contents).byteLength <= MAX_FILE_MOUNT_BYTES, {
    message: `File contents must be ${MAX_FILE_MOUNT_BYTES / 1024} KiB or less`,
  })

export const fileMountModeSchema = z.number().int().min(0).max(MAX_FILE_MODE)

export const scopedFileMountSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
  mode: fileMountModeSchema,
})
export type ScopedFileMount = z.infer<typeof scopedFileMountSchema>

export const fileMountSummarySchema = z.object({
  path: z.string(),
  mode: fileMountModeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type FileMountSummary = z.infer<typeof fileMountSummarySchema>

export const projectFileMountListSchema = z.object({ mounts: z.array(fileMountSummarySchema) })
export type ProjectFileMountList = z.infer<typeof projectFileMountListSchema>

export const projectFileMountKeySchema = projectIdInputSchema.extend({ path: fileMountPathSchema })
export type ProjectFileMountKey = z.infer<typeof projectFileMountKeySchema>

export const projectFileMountSetSchema = projectFileMountKeySchema.extend({
  contents: fileMountContentsSchema,
  mode: fileMountModeSchema.default(DEFAULT_FILE_MOUNT_MODE),
})
export type ProjectFileMountSet = z.input<typeof projectFileMountSetSchema>
export type ProjectFileMountSetInput = z.output<typeof projectFileMountSetSchema>

export const projectFileMountContentsSchema = z.object({ contents: z.string() })
export type ProjectFileMountContents = z.infer<typeof projectFileMountContentsSchema>

export const projectRepoTreeSchema = z.object({
  entries: z.array(z.object({ path: z.string(), kind: z.enum(ERepoTreeEntryKind) })),
  truncated: z.boolean(),
})
export type ProjectRepoTree = z.infer<typeof projectRepoTreeSchema>
