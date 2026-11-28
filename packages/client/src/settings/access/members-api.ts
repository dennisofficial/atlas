import { EAccessScope, type AccessScope } from '@dltech/atlas-wire/web'

type SecretInput = { name: string; value: string; grantId: string }
type FileInput = { path: string; contents: string; mode: number; grantId: string }
type Mutation<T> = { mutate: (input: T) => Promise<void> }
type Query<T, R> = { query: (input: T) => Promise<R> }
type ScopedRoutes<T> = {
  setSecret: Mutation<T & SecretInput>
  removeSecret: Mutation<T & { name: string }>
  revealSecret: Query<T & { name: string }, { value: string }>
  setFileMount: Mutation<T & FileInput>
  removeFileMount: Mutation<T & { path: string }>
  revealFileMount: Query<T & { path: string }, { contents: string }>
}
export type AccessMemberTransport = {
  secrets: {
    set: Mutation<SecretInput>
    remove: Mutation<{ name: string }>
    reveal: Query<{ name: string }, { value: string }>
  }
  personalFileMounts: {
    set: Mutation<FileInput>
    remove: Mutation<{ path: string }>
    reveal: Query<{ path: string }, { contents: string }>
  }
  projectResources: ScopedRoutes<{ projectId: string }>
  groupResources: ScopedRoutes<{ groupId: string }>
}
export type AccessMemberApi = {
  setSecret: (args: SecretInput) => Promise<void>
  removeSecret: (name: string) => Promise<void>
  revealSecret: (name: string) => Promise<string>
  setFile: (args: FileInput) => Promise<void>
  removeFile: (path: string) => Promise<void>
  revealFile: (path: string) => Promise<string>
}

export function createAccessMemberApi({
  api,
  scope,
}: {
  api: AccessMemberTransport
  scope: AccessScope
}): AccessMemberApi {
  if (scope.kind === EAccessScope.Personal)
    return {
      setSecret: (args) => api.secrets.set.mutate(args),
      removeSecret: (name) => api.secrets.remove.mutate({ name }),
      revealSecret: async (name) => (await api.secrets.reveal.query({ name })).value,
      setFile: (args) => api.personalFileMounts.set.mutate(args),
      removeFile: (path) => api.personalFileMounts.remove.mutate({ path }),
      revealFile: async (path) => (await api.personalFileMounts.reveal.query({ path })).contents,
    }
  if (scope.kind === EAccessScope.Group)
    return {
      setSecret: (args) => api.groupResources.setSecret.mutate({ groupId: scope.groupId, ...args }),
      removeSecret: (name) =>
        api.groupResources.removeSecret.mutate({ groupId: scope.groupId, name }),
      revealSecret: async (name) =>
        (await api.groupResources.revealSecret.query({ groupId: scope.groupId, name })).value,
      setFile: (args) =>
        api.groupResources.setFileMount.mutate({ groupId: scope.groupId, ...args }),
      removeFile: (path) =>
        api.groupResources.removeFileMount.mutate({ groupId: scope.groupId, path }),
      revealFile: async (path) =>
        (await api.groupResources.revealFileMount.query({ groupId: scope.groupId, path })).contents,
    }
  return {
    setSecret: (args) =>
      api.projectResources.setSecret.mutate({ projectId: scope.projectId, ...args }),
    removeSecret: (name) =>
      api.projectResources.removeSecret.mutate({ projectId: scope.projectId, name }),
    revealSecret: async (name) =>
      (await api.projectResources.revealSecret.query({ projectId: scope.projectId, name })).value,
    setFile: (args) =>
      api.projectResources.setFileMount.mutate({ projectId: scope.projectId, ...args }),
    removeFile: (path) =>
      api.projectResources.removeFileMount.mutate({ projectId: scope.projectId, path }),
    revealFile: async (path) =>
      (await api.projectResources.revealFileMount.query({ projectId: scope.projectId, path }))
        .contents,
  }
}
