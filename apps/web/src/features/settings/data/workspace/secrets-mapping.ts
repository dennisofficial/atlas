import { ESecretKind as EWireSecretKind } from '@dltech/atlas-wire/web'

import {
  ESecretKind,
  type LibraryMember,
  type LibrarySecret,
} from '@/features/settings/fixtures/settings-library'
import { initialsOf } from '@/features/settings/session/initials'

import { relativeTimeOf } from './relative-time'
import type { ListedSecret } from './resource-api'

const UNKNOWN_MEMBER: LibraryMember = { name: '—', initials: '—' }

export const wireKindOf = (kind: ESecretKind): EWireSecretKind =>
  kind === ESecretKind.EnvVar ? EWireSecretKind.EnvVar : EWireSecretKind.Secret

export const kindOfWire = (kind: EWireSecretKind): ESecretKind =>
  kind === EWireSecretKind.EnvVar ? ESecretKind.EnvVar : ESecretKind.Secret

export function memberOfSecret(secret: ListedSecret): LibraryMember {
  const name = secret.updatedBy?.name
  if (name === undefined || name === '') return UNKNOWN_MEMBER
  return { name, initials: initialsOf(name) }
}

export function librarySecretOf({
  secret,
  now,
}: {
  secret: ListedSecret
  now: number
}): LibrarySecret {
  return {
    id: secret.name,
    key: secret.name,
    kind: kindOfWire(secret.kind),
    value: secret.value,
    updated: relativeTimeOf({ iso: secret.updatedAt, now }),
    addedBy: memberOfSecret(secret),
  }
}
