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
