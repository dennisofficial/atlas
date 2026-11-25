import { EAccessScope, type AccessGrant, type AccessScope } from '@dltech/atlas-wire/web'

export enum EMemberKind {
  Secret = 'secret',
  File = 'file',
}

export type MemberOption = {
  kind: EMemberKind
  name: string
  holder: string | null
}

const membersOf = (args: { grant: AccessGrant; kind: EMemberKind }): readonly string[] =>
  args.kind === EMemberKind.Secret ? args.grant.secretNames : args.grant.filePaths

export function grantHoldingMember(args: {
  grants: readonly AccessGrant[]
  kind: EMemberKind
  name: string
}): AccessGrant | null {
  return (
    args.grants.find((grant) => membersOf({ grant, kind: args.kind }).includes(args.name)) ?? null
  )
}

export function memberOptions(args: {
  grants: readonly AccessGrant[]
  kind: EMemberKind
  names: readonly string[]
}): MemberOption[] {
  return [...new Set(args.names)].sort().map((name) => ({
    kind: args.kind,
    name,
    holder: grantHoldingMember({ grants: args.grants, kind: args.kind, name })?.name ?? null,
  }))
}

export function toggledMember(names: readonly string[], name: string): string[] {
  return names.includes(name) ? names.filter((candidate) => candidate !== name) : [...names, name]
}

export function scopeKeyOf(scope: AccessScope): string {
  if (scope.kind === EAccessScope.Personal) return EAccessScope.Personal
  return `${scope.kind}:${scope.projectId}`
}

export function secretsQueryKeyOf(scope: AccessScope): string {
  return scope.kind === EAccessScope.Personal ? 'personal-secrets' : `secrets:${scope.projectId}`
}

export function fileMountsQueryKeyOf(scope: AccessScope): string | null {
  return scope.kind === EAccessScope.Project ? `file-mounts:${scope.projectId}` : null
}
