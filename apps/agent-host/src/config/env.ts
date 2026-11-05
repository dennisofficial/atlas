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
  vercelOauth: { clientId: string; clientSecret: string } | null
  maxSessions: number
  sandboxImage: string
  daemonBundlePath: string
}

const DEFAULT_MAX_SESSIONS = 25
const DEFAULT_SANDBOX_IMAGE = 'atlas-sandbox:latest'

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
  const required: ReadonlyArray<[string, string | undefined]> = [
    ['DATABASE_URL', databaseUrl],
    ['DATABASE_DIRECT_URL', databaseDirectUrl],
    ['REDIS_URL', redisUrl],
    ['DAEMON_SECRET', daemonSecret],
    ['SECRETS_ENCRYPTION_KEY', secretsEncryptionKey],
    ['ATLAS_API_ORIGIN', apiOrigin],
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
    vercelOauth: vercelOauthOf(env),
    maxSessions: parseMaxSessions(take(env, 'AGENT_HOST_MAX_SESSIONS')),
    sandboxImage: take(env, 'ATLAS_SANDBOX_IMAGE') ?? DEFAULT_SANDBOX_IMAGE,
    daemonBundlePath: take(env, 'ATLAS_DAEMON_BUNDLE') ?? defaultDaemonBundlePath(),
  }
}
