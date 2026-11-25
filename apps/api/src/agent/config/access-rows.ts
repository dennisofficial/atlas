export type AccessGrantRow = { id: string; name: string; instruction: string }

export type AccessGroupRow = { id: string; name: string }

export type AccessSecretRow = { name: string; grantId: string }

export type AccessFileRow = { path: string; grantId: string }

export type AccessRows = {
  group: AccessGroupRow | null
  userGrants: readonly AccessGrantRow[]
  groupGrants: readonly AccessGrantRow[]
  projectGrants: readonly AccessGrantRow[]
  userSecrets: readonly AccessSecretRow[]
  groupSecrets: readonly AccessSecretRow[]
  projectSecrets: readonly AccessSecretRow[]
  userFiles: readonly AccessFileRow[]
  groupFiles: readonly AccessFileRow[]
  projectFiles: readonly AccessFileRow[]
}

export type AccessSource = {
  read(args: { userId: string; projectId: string | null }): Promise<AccessRows>
}
