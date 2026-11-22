import { fileURLToPath } from 'node:url'

export class PodsEnvError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`pods refuses to start; missing env vars: ${missing.join(', ')}`)
    this.name = 'PodsEnvError'
  }
}

import type { Agent37Resources } from './sandbox/agent37/agent37-client'

export type { Agent37Resources }

export type PodsEnv = {
  daemonSecret: string
  secretsEncryptionKey: string
  apiOrigin: string
  platformVercel: { token: string; teamId: string; projectId: string } | null
  agent37: { apiKey: string; template: string; resources: Agent37Resources } | null
  sandboxImage: string
  daemonBundlePath: string
  publicUrl: string
}

const DEFAULT_SANDBOX_IMAGE = 'atlas-sandbox:latest'
const DEFAULT_PUBLIC_URL = 'https://api.byatlas.io'
const DEFAULT_AGENT37_CPU = 2
const DEFAULT_AGENT37_MEMORY_GB = 4
const DEFAULT_AGENT37_DISK_GB = 20

export const defaultDaemonBundlePath = (): string =>
  fileURLToPath(new URL('../../../apps/daemon/bin/daemon.js', import.meta.url))

export const take = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const value = env[name]
  return value === undefined || value.trim() === '' ? undefined : value
}

export const parsePositiveInteger = (args: {
  raw: string | undefined
  name: string
  fallback: number
}): number => {
  if (args.raw === undefined) return args.fallback
  const parsed = Number(args.raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new PodsEnvError([`${args.name} must be a positive integer, got "${args.raw}"`])
  }
  return parsed
}

export const platformVercelOf = (
  env: Record<string, string | undefined>,
): { value: PodsEnv['platformVercel']; missing: string[] } => {
  const token = take(env, 'PLATFORM_VERCEL_TOKEN')
  const teamId = take(env, 'PLATFORM_VERCEL_TEAM_ID')
  const projectId = take(env, 'PLATFORM_VERCEL_PROJECT_ID')
  const missing = [
    ...(token === undefined ? ['PLATFORM_VERCEL_TOKEN'] : []),
    ...(teamId === undefined ? ['PLATFORM_VERCEL_TEAM_ID'] : []),
    ...(projectId === undefined ? ['PLATFORM_VERCEL_PROJECT_ID'] : []),
  ]
  if (missing.length === 3) return { value: null, missing: [] }
  if (token === undefined || teamId === undefined || projectId === undefined) {
    return { value: null, missing }
  }
  return { value: { token, teamId, projectId }, missing: [] }
}

export const agent37Of = (env: Record<string, string | undefined>): PodsEnv['agent37'] => {
  const apiKey = take(env, 'AGENT37_API_KEY')
  const template = take(env, 'AGENT37_TEMPLATE_ID')
  if (apiKey === undefined || template === undefined) return null
  return {
    apiKey,
    template,
    resources: {
      cpu: parsePositiveInteger({
        raw: take(env, 'AGENT37_CPU'),
        name: 'AGENT37_CPU',
        fallback: DEFAULT_AGENT37_CPU,
      }),
      memory: parsePositiveInteger({
        raw: take(env, 'AGENT37_MEMORY_GB'),
        name: 'AGENT37_MEMORY_GB',
        fallback: DEFAULT_AGENT37_MEMORY_GB,
      }),
      disk: parsePositiveInteger({
        raw: take(env, 'AGENT37_DISK_GB'),
        name: 'AGENT37_DISK_GB',
        fallback: DEFAULT_AGENT37_DISK_GB,
      }),
    },
  }
}

export const sandboxImageOf = (env: Record<string, string | undefined>): string =>
  take(env, 'ATLAS_SANDBOX_IMAGE') ?? DEFAULT_SANDBOX_IMAGE

export const publicUrlOf = (env: Record<string, string | undefined>): string =>
  take(env, 'AGENT_HOST_PUBLIC_URL') ?? DEFAULT_PUBLIC_URL

export const daemonBundlePathOf = (env: Record<string, string | undefined>): string =>
  take(env, 'ATLAS_DAEMON_BUNDLE') ?? defaultDaemonBundlePath()

export const readPodsEnv = (env: Record<string, string | undefined> = process.env): PodsEnv => {
  const daemonSecret = take(env, 'DAEMON_SECRET')
  const secretsEncryptionKey = take(env, 'SECRETS_ENCRYPTION_KEY')
  const apiOrigin = take(env, 'ATLAS_API_ORIGIN')
  const platformVercel = platformVercelOf(env)
  const required: ReadonlyArray<[string, string | undefined]> = [
    ['DAEMON_SECRET', daemonSecret],
    ['SECRETS_ENCRYPTION_KEY', secretsEncryptionKey],
    ['ATLAS_API_ORIGIN', apiOrigin],
  ]
  const missing = [
    ...required.filter((pair) => pair[1] === undefined).map((pair) => pair[0]),
    ...platformVercel.missing,
  ]
  if (missing.length > 0) throw new PodsEnvError(missing)
  return {
    daemonSecret: daemonSecret as string,
    secretsEncryptionKey: secretsEncryptionKey as string,
    apiOrigin: apiOrigin as string,
    platformVercel: platformVercel.value,
    agent37: agent37Of(env),
    sandboxImage: sandboxImageOf(env),
    daemonBundlePath: daemonBundlePathOf(env),
    publicUrl: publicUrlOf(env),
  }
}
