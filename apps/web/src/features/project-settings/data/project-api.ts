import { z } from 'zod'

import { projectSchema, type EShipBehavior, type ProjectSandbox } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export const projectViewSchema = projectSchema.extend({
  organizationId: z.string().nullable().default(null),
})
export type ProjectView = z.infer<typeof projectViewSchema>

export type SaveProjectBody = {
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: { repo: string; branch?: string }[]
  description: string
  shipBehavior: EShipBehavior
  organizationId?: string | null
}

export type CreateProjectBody = Omit<SaveProjectBody, 'shipBehavior'>

export const createProject = async (body: CreateProjectBody): Promise<ProjectView> =>
  projectViewSchema.parse(await cloudCall(api.projects.create.mutate(body)))

export const fetchProject = async (projectId: string): Promise<ProjectView> =>
  projectViewSchema.parse(await cloudCall(api.projects.get.query({ projectId })))

export const saveProject = async (args: {
  projectId: string
  body: SaveProjectBody
}): Promise<ProjectView> =>
  projectViewSchema.parse(
    await cloudCall(api.projects.update.mutate({ projectId: args.projectId, ...args.body })),
  )

export const deleteProject = (projectId: string): Promise<void> =>
  cloudCall(api.projects.remove.mutate({ projectId }))

export const fetchSandbox = (projectId: string): Promise<ProjectSandbox> =>
  cloudCall(api.projectResources.getSandbox.query({ projectId }))

export const saveSandbox = (args: {
  projectId: string
  sandbox: ProjectSandbox
}): Promise<ProjectSandbox> =>
  cloudCall(api.projectResources.saveSandbox.mutate({ projectId: args.projectId, ...args.sandbox }))
