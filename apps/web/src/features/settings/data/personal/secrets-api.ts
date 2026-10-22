import { z } from 'zod'

import { secretDetailSchema, type SecretDetail } from '@dltech/atlas-wire/web'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'

import {
  ESecretKind,
  type LibraryMember,
  type LibrarySecret,
} from '../../fixtures/settings-library'
import type { SecretEntry } from '../../parts/library-secret-dialogs'
import { relativeTime } from './relative-time'

const detailsSchema = z.object({ secrets: z.array(secretDetailSchema) })

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
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: '/v1/secrets/details',
    schema: detailsSchema,
  })
  return body.secrets
}

export function putSecret(args: { name: string; value: string; kind: ESecretKind }): Promise<void> {
  return cloudSend({
    method: EHttpMethod.Put,
    path: `/v1/secrets/${encodeURIComponent(args.name)}`,
    body: { value: args.value, kind: args.kind },
  })
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
  return cloudSend({ method: EHttpMethod.Delete, path: `/v1/secrets/${encodeURIComponent(name)}` })
}
