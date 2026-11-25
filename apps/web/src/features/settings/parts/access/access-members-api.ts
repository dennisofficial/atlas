import { EAccessScope, type AccessScope } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export type AccessMemberApi = {
  setSecret: (args: { grantId: string; name: string; value: string }) => Promise<void>
  removeSecret: (name: string) => Promise<void>
  revealSecret: (name: string) => Promise<string>
  setFile: (args: {
    grantId: string
    path: string
    contents: string
    mode: number
  }) => Promise<void>
  removeFile: (path: string) => Promise<void>
  revealFile: (path: string) => Promise<string>
}

const personalApi: AccessMemberApi = {
  setSecret: (args) =>
    cloudCall(
      api.secrets.set.mutate({ name: args.name, value: args.value, grantId: args.grantId }),
    ),
  removeSecret: (name) => cloudCall(api.secrets.remove.mutate({ name })),
  revealSecret: async (name) => (await cloudCall(api.secrets.reveal.query({ name }))).value,
  setFile: (args) =>
    cloudCall(
      api.personalFileMounts.set.mutate({
        path: args.path,
        contents: args.contents,
        mode: args.mode,
        grantId: args.grantId,
      }),
    ),
  removeFile: (path) => cloudCall(api.personalFileMounts.remove.mutate({ path })),
  revealFile: async (path) =>
    (await cloudCall(api.personalFileMounts.reveal.query({ path }))).contents,
}

const projectApiOf = (projectId: string): AccessMemberApi => ({
  setSecret: (args) =>
    cloudCall(
      api.projectResources.setSecret.mutate({
        projectId,
        name: args.name,
        value: args.value,
        grantId: args.grantId,
      }),
    ),
  removeSecret: (name) => cloudCall(api.projectResources.removeSecret.mutate({ projectId, name })),
  revealSecret: async (name) =>
    (await cloudCall(api.projectResources.revealSecret.query({ projectId, name }))).value,
  setFile: (args) =>
    cloudCall(
      api.projectResources.setFileMount.mutate({
        projectId,
        path: args.path,
        contents: args.contents,
        mode: args.mode,
        grantId: args.grantId,
      }),
    ),
  removeFile: (path) => cloudCall(api.projectResources.removeFileMount.mutate({ projectId, path })),
  revealFile: async (path) =>
    (await cloudCall(api.projectResources.revealFileMount.query({ projectId, path }))).contents,
})

export function accessMemberApiOf(scope: AccessScope): AccessMemberApi {
  if (scope.kind === EAccessScope.Personal) return personalApi
  return projectApiOf(scope.projectId)
}
