import { EAccessScope, type AccessGrant, type AccessScope } from '@dltech/atlas-wire/web'

export function scopeKeyOf(scope: AccessScope): string {
  if (scope.kind === EAccessScope.Personal) return EAccessScope.Personal
  if (scope.kind === EAccessScope.Group) return `${scope.kind}:${scope.groupId}`
  return `${scope.kind}:${scope.projectId}`
}

export function moveTargetsOf({
  grants,
  fromGrantId,
}: {
  grants: readonly AccessGrant[]
  fromGrantId: string
}): AccessGrant[] {
  return grants.filter((grant) => grant.id !== fromGrantId)
}

export type GrantMoveTarget = { name: string; scope: AccessScope }

export type GrantMoveBranch = { label: string; targets: readonly GrantMoveTarget[] }

export type GrantMoveScopeOption = { id: string; name: string }

export function grantMoveBranchesOf(args: {
  scope: AccessScope
  groups: readonly GrantMoveScopeOption[]
  projects: readonly GrantMoveScopeOption[]
}): GrantMoveBranch[] {
  const personal: GrantMoveTarget[] =
    args.scope.kind === EAccessScope.Personal
      ? []
      : [{ name: 'Personal', scope: { kind: EAccessScope.Personal } }]
  const groups: GrantMoveTarget[] = args.groups
    .filter((group) => args.scope.kind !== EAccessScope.Group || args.scope.groupId !== group.id)
    .map((group) => ({
      name: group.name,
      scope: { kind: EAccessScope.Group, groupId: group.id } as const,
    }))
  const projects: GrantMoveTarget[] = args.projects
    .filter(
      (project) => args.scope.kind !== EAccessScope.Project || args.scope.projectId !== project.id,
    )
    .map((project) => ({
      name: project.name,
      scope: { kind: EAccessScope.Project, projectId: project.id } as const,
    }))
  return [
    { label: 'Personal', targets: personal },
    { label: 'Group', targets: groups },
    { label: 'Project', targets: projects },
  ].filter((branch) => branch.targets.length > 0)
}

const counted = ({ count, one, many }: { count: number; one: string; many: string }): string =>
  `${count} ${count === 1 ? one : many}`

export function deleteGrantDescription(grant: AccessGrant): string {
  const secrets = counted({ count: grant.secrets.length, one: 'secret', many: 'secrets' })
  const files = counted({ count: grant.files.length, one: 'file', many: 'files' })
  if (grant.secrets.length === 0 && grant.files.length === 0) {
    return 'The grant has no secrets or files. This cannot be undone.'
  }
  const members = [
    grant.secrets.length === 0 ? null : secrets,
    grant.files.length === 0 ? null : files,
  ]
    .filter((part) => part !== null)
    .join(' and ')
  return `Deletes the grant and its ${members}. This cannot be undone.`
}
