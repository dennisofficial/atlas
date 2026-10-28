import type { EShipBehavior, Project, ProjectSandbox } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type ProjectView = Project

export type SaveProjectBody = {
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: { repo: string; branch?: string }[]
  description: string
  shipBehavior: EShipBehavior
}

export type CreateProjectBody = Omit<SaveProjectBody, 'shipBehavior'>

export const createProject = (body: CreateProjectBody): Promise<ProjectView> =>
  cloudCall(api.projects.create.mutate(body))

export const fetchProject = (projectId: string): Promise<ProjectView> =>
  cloudCall(api.projects.get.query({ projectId }))

export const saveProject = (args: {
  projectId: string
  body: SaveProjectBody
}): Promise<ProjectView> =>
  cloudCall(api.projects.update.mutate({ projectId: args.projectId, ...args.body }))

export const deleteProject = (projectId: string): Promise<void> =>
  cloudCall(api.projects.remove.mutate({ projectId }))

export const fetchSandbox = (projectId: string): Promise<ProjectSandbox> =>
  cloudCall(api.projectResources.getSandbox.query({ projectId }))

export const saveSandbox = (args: {
  projectId: string
  sandbox: ProjectSandbox
}): Promise<ProjectSandbox> =>
  cloudCall(api.projectResources.saveSandbox.mutate({ projectId: args.projectId, ...args.sandbox }))
