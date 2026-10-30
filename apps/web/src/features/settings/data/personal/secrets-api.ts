import type { SecretSummary } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import type { EnvSecretRow } from '../../parts/env-secrets-table'
import { relativeTime } from './relative-time'

export function toEnvSecretRow(args: { summary: SecretSummary; now?: number }): EnvSecretRow {
  const { summary } = args
  return {
    name: summary.name,
    updated: relativeTime({
      from: summary.updatedAt,
      ...(args.now === undefined ? {} : { now: args.now }),
    }),
  }
}

export async function fetchSecretSummaries(): Promise<SecretSummary[]> {
  const body = await cloudCall(api.secrets.details.query())
  return body.secrets
}

export async function revealSecret(name: string): Promise<string> {
  const body = await cloudCall(api.secrets.reveal.query({ name }))
  return body.value
}

export function putSecret(args: { name: string; value: string }): Promise<void> {
  return cloudCall(api.secrets.set.mutate({ name: args.name, value: args.value }))
}

export function deleteSecret(name: string): Promise<void> {
  return cloudCall(api.secrets.remove.mutate({ name }))
}
