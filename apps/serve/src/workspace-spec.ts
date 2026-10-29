import { z } from 'zod'

import { projectRepoSchema } from '@dltech/atlas-wire'

export const wireWorkspaceSpecSchema = z.object({
  remoteUrl: z.string().nullable(),
  githubToken: z.string().nullable(),
  /** The model the thread is on; null when none was picked, absent on an older control plane. */
  model: z.string().nullable().nullish(),
  effort: z.string().nullish(),
  projectId: z.string().nullish(),
  baseBranch: z.string().nullish(),
  additionalRepos: z.array(projectRepoSchema).nullish(),
})

export type WorkspaceSpec = z.infer<typeof wireWorkspaceSpecSchema>

export type FetchWorkspaceSpec = () => Promise<WorkspaceSpec>
