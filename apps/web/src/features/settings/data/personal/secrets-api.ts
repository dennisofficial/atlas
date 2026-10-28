import type { SecretDetail } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import {
  ESecretKind,
  type LibraryMember,
  type LibrarySecret,
} from '../../fixtures/settings-library'
import type { SecretEntry } from '../../parts/library-secret-dialogs'
import { wireKindOf } from '../shared/secrets-mapping'
import { relativeTime } from './relative-time'

export function toLibrarySecret(args: {
  detail: SecretDetail
  addedBy: LibraryMember
  now?: number
}): LibrarySecret {
  const { detail } = args
  return {
    id: detail.name,
    key: detail.name,
    kind: detail.kind === 'env' ? ESecretKind.EnvVar : ESecretKind.Secret,
    value: detail.value,
    updated: relativeTime({
      from: detail.updatedAt,
      ...(args.now === undefined ? {} : { now: args.now }),
    }),
    addedBy: args.addedBy,
  }
}

export async function fetchSecretDetails(): Promise<SecretDetail[]> {
  const body = await cloudCall(api.secrets.details.query())
  return body.secrets
}

export function putSecret(args: { name: string; value: string; kind: ESecretKind }): Promise<void> {
  return cloudCall(
    api.secrets.set.mutate({ name: args.name, value: args.value, kind: wireKindOf(args.kind) }),
  )
}

export function saveSecretEntry(args: {
  entry: SecretEntry
  secrets: readonly LibrarySecret[]
}): Promise<void> {
  const { entry } = args
  const existing = args.secrets.find((secret) => secret.key === entry.key)
  const value = entry.value === '' ? (existing?.value ?? '') : entry.value
  if (value === '') throw new Error('A value is required')
  return putSecret({ name: entry.key, value, kind: entry.kind })
}

export function deleteSecret(name: string): Promise<void> {
  return cloudCall(api.secrets.remove.mutate({ name }))
}
