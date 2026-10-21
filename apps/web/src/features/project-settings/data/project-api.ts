import { projectSandboxSchema, projectSchema, type ProjectSandbox } from '@dltech/atlas-wire/web'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'
import { projectBase } from '@/features/settings/data/workspace/resource-api'

export type SaveProjectBody = {
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: { repo: string; branch?: string }[]
  description: string
  shipBehavior: string
}

export const fetchProject = (projectId: string) =>
  cloudJson({ method: EHttpMethod.Get, path: projectBase(projectId), schema: projectSchema })

export const saveProject = (args: { projectId: string; body: SaveProjectBody }) =>
  cloudJson({
    method: EHttpMethod.Put,
    path: projectBase(args.projectId),
    body: args.body,
    schema: projectSchema,
  })

export const deleteProject = (projectId: string) =>
  cloudSend({ method: EHttpMethod.Delete, path: projectBase(projectId) })

export const fetchSandbox = (projectId: string) =>
  cloudJson({
    method: EHttpMethod.Get,
    path: `${projectBase(projectId)}/sandbox`,
    schema: projectSandboxSchema,
  })

export const saveSandbox = (args: { projectId: string; sandbox: ProjectSandbox }) =>
  cloudJson({
    method: EHttpMethod.Put,
    path: `${projectBase(args.projectId)}/sandbox`,
    body: args.sandbox,
    schema: projectSandboxSchema,
  })
