import type { SecretSummary } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import type { LibraryMember, LibrarySecret } from '../../fixtures/settings-library'
import type { SecretEntry } from '../../parts/library-secret-dialogs'
import { relativeTime } from './relative-time'

export function toLibrarySecret(args: {
  summary: SecretSummary
  addedBy: LibraryMember
  now?: number
}): LibrarySecret {
  const { summary } = args
  return {
    id: summary.name,
    key: summary.name,
    updated: relativeTime({
      from: summary.updatedAt,
      ...(args.now === undefined ? {} : { now: args.now }),
    }),
    addedBy: args.addedBy,
  }
}

export async function fetchSecretSummaries(): Promise<SecretSummary[]> {
  const body = await cloudCall(api.secrets.details.query())
  return body.secrets
}

export async function fetchSecretNames(): Promise<string[]> {
  const body = await cloudCall(api.secrets.names.query())
  return body.names
}

export async function revealSecret(name: string): Promise<string> {
  const body = await cloudCall(api.secrets.reveal.query({ name }))
  return body.value
}

export function putSecret(args: { name: string; value: string }): Promise<void> {
  return cloudCall(api.secrets.set.mutate({ name: args.name, value: args.value }))
}

export function saveSecretEntry(args: { entry: SecretEntry }): Promise<void> {
  const { entry } = args
  if (entry.value === '') throw new Error('A value is required')
  return putSecret({ name: entry.key, value: entry.value })
}

export function deleteSecret(name: string): Promise<void> {
  return cloudCall(api.secrets.remove.mutate({ name }))
}
