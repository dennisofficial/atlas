import type { ApiClient } from '@dltech/atlas-api-router'
import {
  projectListSchema,
  projectSchema,
  type Project,
  type ProjectRepo,
} from '@dltech/atlas-wire'

import { cloudCall } from './api-trpc-client'

export type ProjectInput = {
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: ProjectRepo[]
}

export const listProjectsVia = async (api: ApiClient): Promise<Project[]> =>
  projectListSchema.parse(await cloudCall(api.projects.list.query()))

export const createProjectVia = async (args: {
  api: ApiClient
  input: ProjectInput
}): Promise<Project> =>
  projectSchema.parse(await cloudCall(args.api.projects.create.mutate(args.input)))
