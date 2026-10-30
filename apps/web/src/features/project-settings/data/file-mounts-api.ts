import type { FileMountSummary, ProjectRepoTree } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type ListedFileMount = FileMountSummary

export async function listFileMounts(projectId: string): Promise<ListedFileMount[]> {
  const body = await cloudCall(api.projectResources.listFileMounts.query({ projectId }))
  return body.mounts
}

export async function revealFileMount(args: { projectId: string; path: string }): Promise<string> {
  const body = await cloudCall(api.projectResources.revealFileMount.query(args))
  return body.contents
}

export const putFileMount = (args: {
  projectId: string
  path: string
  contents: string
  mode: number
}): Promise<void> => cloudCall(api.projectResources.setFileMount.mutate(args))

export const deleteFileMount = (args: { projectId: string; path: string }): Promise<void> =>
  cloudCall(api.projectResources.removeFileMount.mutate(args))

export const fetchRepoTree = (projectId: string): Promise<ProjectRepoTree> =>
  cloudCall(api.projectResources.repoTree.query({ projectId }))
