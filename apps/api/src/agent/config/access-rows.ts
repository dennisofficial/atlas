export type AccessGrantRow = { id: string; name: string; instruction: string }

export type AccessSecretRow = { name: string; grantId: string }

export type AccessFileRow = { path: string; grantId: string }

export type AccessRows = {
  userGrants: readonly AccessGrantRow[]
  projectGrants: readonly AccessGrantRow[]
  userSecrets: readonly AccessSecretRow[]
  projectSecrets: readonly AccessSecretRow[]
  userFiles: readonly AccessFileRow[]
  projectFiles: readonly AccessFileRow[]
}

export type AccessSource = {
  read(args: { userId: string; projectId: string | null }): Promise<AccessRows>
}
