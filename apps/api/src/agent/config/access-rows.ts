export type AccessGrantRow = { id: string; name: string; instruction: string }

export type AccessSecretRow = { name: string; grantId: string | null }

export type AccessFileRow = { path: string; grantId: string | null }

export type AccessRows = {
  userGrants: readonly AccessGrantRow[]
  projectGrants: readonly AccessGrantRow[]
  userSecrets: readonly AccessSecretRow[]
  projectSecrets: readonly AccessSecretRow[]
  projectFiles: readonly AccessFileRow[]
}

export type AccessSource = {
  read(args: { userId: string; projectId: string | null }): Promise<AccessRows>
}
