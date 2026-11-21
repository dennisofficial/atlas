import { fileURLToPath } from 'node:url'

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
  platformVercel: { token: string; teamId: string; projectId: string } | null
  agent37: {
    apiKey: string
    template: string
    resources: { cpu: number; memory: number; disk: number }
  } | null
  mediaBlobToken: string | null
  sandboxImage: string
  daemonBundlePath: string
  port: number
  publicUrl: string
  trustedOrigins: string[]
}

const DEFAULT_SANDBOX_IMAGE = 'atlas-sandbox:latest'
const DEFAULT_PORT = 10_000
const DEFAULT_PREVIEW_DOMAIN = 'byatlas.dev'
const DEFAULT_PUBLIC_URL = 'https://api.byatlas.io'
const DEFAULT_AGENT37_CPU = 2
const DEFAULT_AGENT37_MEMORY_GB = 4
const DEFAULT_AGENT37_DISK_GB = 20

const defaultDaemonBundlePath = (): string =>
  fileURLToPath(new URL('../../../../daemon/bin/daemon.js', import.meta.url))

const take = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const value = env[name]
  return value === undefined || value.trim() === '' ? undefined : value
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

const platformVercelOf = (
  env: Record<string, string | undefined>,
): { value: AgentHostEnv['platformVercel']; missing: string[] } => {
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

const parsePositiveInteger = (args: {
  raw: string | undefined
  name: string
  fallback: number
}): number => {
  if (args.raw === undefined) return args.fallback
  const parsed = Number(args.raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AgentHostEnvError([`${args.name} must be a positive integer, got "${args.raw}"`])
  }
  return parsed
}

const agent37Of = (env: Record<string, string | undefined>): AgentHostEnv['agent37'] => {
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

export const readAgentHostEnv = (
  env: Record<string, string | undefined> = process.env,
): AgentHostEnv => {
  const databaseUrl = take(env, 'DATABASE_URL')
  const databaseDirectUrl = take(env, 'DATABASE_DIRECT_URL') ?? take(env, 'DIRECT_URL')
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
  const platformVercel = platformVercelOf(env)
  const missing = [
    ...required.filter((pair) => pair[1] === undefined).map((pair) => pair[0]),
    ...platformVercel.missing,
  ]
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
    platformVercel: platformVercel.value,
    agent37: agent37Of(env),
    mediaBlobToken: take(env, 'BLOB_READ_WRITE_TOKEN') ?? null,
    sandboxImage: take(env, 'ATLAS_SANDBOX_IMAGE') ?? DEFAULT_SANDBOX_IMAGE,
    daemonBundlePath: take(env, 'ATLAS_DAEMON_BUNDLE') ?? defaultDaemonBundlePath(),
    port: parsePort(take(env, 'PORT')),
    publicUrl: take(env, 'AGENT_HOST_PUBLIC_URL') ?? DEFAULT_PUBLIC_URL,
    trustedOrigins: parseOrigins(take(env, 'TRUSTED_ORIGINS')),
  }
}
