import type { Agent37Resources, PodsEnv } from '@dltech/atlas-pods/env'
import {
  agent37Of,
  daemonBundlePathOf,
  platformVercelOf,
  PodsEnvError,
  publicUrlOf,
  sandboxImageOf,
  take,
} from '@dltech/atlas-pods/env'

export class AgentHostEnvError extends Error {
  constructor(public readonly missing: readonly string[]) {
    super(`agent-host refuses to start; missing env vars: ${missing.join(', ')}`)
    this.name = 'AgentHostEnvError'
  }
}

export type Agent37Env = { apiKey: string; template: string; resources: Agent37Resources }

export type AgentHostEnv = PodsEnv & {
  databaseUrl: string
  databaseDirectUrl: string
  redisUrl: string
  cloudflare: { apiToken: string; accountId: string; zoneId: string }
  previewDomain: string
  vercelOauth: { clientId: string; clientSecret: string } | null
  mediaBlobToken: string | null
  githubApp: { appId: string | undefined; appPrivateKey: string | undefined }
  port: number
  trustedOrigins: string[]
  jinaApiKey: string | undefined
}

const DEFAULT_PORT = 10_000
const DEFAULT_PREVIEW_DOMAIN = 'byatlas.dev'

const parsePort = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_PORT
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new AgentHostEnvError([`PORT must be an integer from 0 to 65535, got "${raw}"`])
  }
  return parsed
}

const parseList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '')

const vercelOauthOf = (env: Record<string, string | undefined>): AgentHostEnv['vercelOauth'] => {
  const clientId = take(env, 'VERCEL_OAUTH_CLIENT_ID')
  const clientSecret = take(env, 'VERCEL_OAUTH_CLIENT_SECRET')
  return clientId === undefined || clientSecret === undefined ? null : { clientId, clientSecret }
}

const agent37OfOrThrow = (env: Record<string, string | undefined>): AgentHostEnv['agent37'] => {
  try {
    return agent37Of(env)
  } catch (error) {
    if (error instanceof PodsEnvError) throw new AgentHostEnvError(error.missing)
    throw error
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
    agent37: agent37OfOrThrow(env),
    mediaBlobToken: take(env, 'BLOB_READ_WRITE_TOKEN') ?? null,
    githubApp: {
      appId: take(env, 'GITHUB_APP_ID'),
      appPrivateKey: take(env, 'GITHUB_APP_PRIVATE_KEY'),
    },
    sandboxImage: sandboxImageOf(env),
    daemonBundlePath: daemonBundlePathOf(env),
    port: parsePort(take(env, 'PORT')),
    publicUrl: publicUrlOf(env),
    trustedOrigins: parseList(take(env, 'TRUSTED_ORIGINS')),
    jinaApiKey: take(env, 'JINA_API_KEY'),
  }
}
