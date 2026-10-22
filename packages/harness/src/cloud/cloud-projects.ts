import { projectSchema, type Project, type ProjectRepo } from '@dltech/atlas-wire'
import { z } from 'zod'

export type ProjectInput = {
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: ProjectRepo[]
}

type Request = (args: { method: string; path: string; body?: unknown }) => Promise<unknown>

export const listProjectsVia = async (request: Request): Promise<Project[]> =>
  z.array(projectSchema).parse(await request({ method: 'GET', path: '/v1/projects' }))

export const createProjectVia = async (args: {
  request: Request
  input: ProjectInput
}): Promise<Project> =>
  projectSchema.parse(
    await args.request({ method: 'POST', path: '/v1/projects', body: args.input }),
  )
