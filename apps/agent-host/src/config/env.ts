import { join } from 'node:path'

export class AgentHostEnvError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`agent-host refuses to start; missing env vars: ${missing.join(', ')}`)
    this.name = 'AgentHostEnvError'
  }
}

export type AgentHostEnv = {
  databaseUrl: string
  databaseDirectUrl: string
  redisUrl: string
  daemonSecret: string
  secretsEncryptionKey: string
  apiOrigin: string
  cloudflare: { apiToken: string; accountId: string; zoneId: string }
  previewDomain: string
  vercelOauth: { clientId: string; clientSecret: string } | null
  mediaBlobToken: string | null
  maxSessions: number
  drainMs: number
  sandboxImage: string
  daemonBundlePath: string
  port: number
  publicUrl: string
  trustedOrigins: string[]
}

const DEFAULT_MAX_SESSIONS = 25
const DEFAULT_SANDBOX_IMAGE = 'atlas-sandbox:latest'
const DEFAULT_PORT = 10_000
const DEFAULT_PREVIEW_DOMAIN = 'byatlas.dev'
const DEFAULT_PUBLIC_URL = 'https://agent.byatlas.io'
export const DEFAULT_DRAIN_MS = 270_000

const defaultDaemonBundlePath = (): string => join(import.meta.dir, '../../../daemon/bin/daemon.js')

const take = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const value = env[name]
  return value === undefined || value.trim() === '' ? undefined : value
}

const parseMaxSessions = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_MAX_SESSIONS
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AgentHostEnvError([
      `AGENT_HOST_MAX_SESSIONS must be a positive integer, got "${raw}"`,
    ])
  }
  return parsed
}

const parseDrainMs = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_DRAIN_MS
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AgentHostEnvError([`AGENT_HOST_DRAIN_MS must be a positive integer, got "${raw}"`])
  }
  return parsed
}

const parsePort = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_PORT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new AgentHostEnvError([`PORT must be an integer from 0 to 65535, got "${raw}"`])
  }
  return parsed
}

const parseOrigins = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')

const vercelOauthOf = (env: Record<string, string | undefined>): AgentHostEnv['vercelOauth'] => {
  const clientId = take(env, 'VERCEL_OAUTH_CLIENT_ID')
  const clientSecret = take(env, 'VERCEL_OAUTH_CLIENT_SECRET')
  return clientId === undefined || clientSecret === undefined ? null : { clientId, clientSecret }
}

export const readAgentHostEnv = (
  env: Record<string, string | undefined> = process.env,
): AgentHostEnv => {
  const databaseUrl = take(env, 'DATABASE_URL')
  const databaseDirectUrl = take(env, 'DATABASE_DIRECT_URL')
  const redisUrl = take(env, 'REDIS_URL')
  const daemonSecret = take(env, 'DAEMON_SECRET')
  const secretsEncryptionKey = take(env, 'SECRETS_ENCRYPTION_KEY')
  const apiOrigin = take(env, 'ATLAS_API_ORIGIN')
  const cloudflareApiToken = take(env, 'CLOUDFLARE_API_TOKEN')
  const cloudflareAccountId = take(env, 'CLOUDFLARE_ACCOUNT_ID')
  const cloudflareZoneId = take(env, 'CLOUDFLARE_ZONE_ID')
  const required: ReadonlyArray<[string, string | undefined]> = [
    ['DATABASE_URL', databaseUrl],
    ['DATABASE_DIRECT_URL', databaseDirectUrl],
    ['REDIS_URL', redisUrl],
    ['DAEMON_SECRET', daemonSecret],
    ['SECRETS_ENCRYPTION_KEY', secretsEncryptionKey],
    ['ATLAS_API_ORIGIN', apiOrigin],
    ['CLOUDFLARE_API_TOKEN', cloudflareApiToken],
    ['CLOUDFLARE_ACCOUNT_ID', cloudflareAccountId],
    ['CLOUDFLARE_ZONE_ID', cloudflareZoneId],
  ]
  const missing = required.filter((pair) => pair[1] === undefined).map((pair) => pair[0])
  if (missing.length > 0) throw new AgentHostEnvError(missing)
  return {
    databaseUrl: databaseUrl as string,
    databaseDirectUrl: databaseDirectUrl as string,
    redisUrl: redisUrl as string,
    daemonSecret: daemonSecret as string,
    secretsEncryptionKey: secretsEncryptionKey as string,
    apiOrigin: apiOrigin as string,
    cloudflare: {
      apiToken: cloudflareApiToken as string,
      accountId: cloudflareAccountId as string,
      zoneId: cloudflareZoneId as string,
    },
    previewDomain: take(env, 'PREVIEW_DOMAIN') ?? DEFAULT_PREVIEW_DOMAIN,
    vercelOauth: vercelOauthOf(env),
    mediaBlobToken: take(env, 'BLOB_READ_WRITE_TOKEN') ?? null,
    maxSessions: parseMaxSessions(take(env, 'AGENT_HOST_MAX_SESSIONS')),
    drainMs: parseDrainMs(take(env, 'AGENT_HOST_DRAIN_MS')),
    sandboxImage: take(env, 'ATLAS_SANDBOX_IMAGE') ?? DEFAULT_SANDBOX_IMAGE,
    daemonBundlePath: take(env, 'ATLAS_DAEMON_BUNDLE') ?? defaultDaemonBundlePath(),
    port: parsePort(take(env, 'PORT')),
    publicUrl: take(env, 'AGENT_HOST_PUBLIC_URL') ?? DEFAULT_PUBLIC_URL,
    trustedOrigins: parseOrigins(take(env, 'TRUSTED_ORIGINS')),
  }
}
