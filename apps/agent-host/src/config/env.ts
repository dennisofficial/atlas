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
  agentHostToken: string
  daemonSecret: string
  apiOrigin: string
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

export const readAgentHostEnv = (
  env: Record<string, string | undefined> = process.env,
): AgentHostEnv => {
  const databaseUrl = take(env, 'DATABASE_URL')
  const databaseDirectUrl = take(env, 'DATABASE_DIRECT_URL')
  const redisUrl = take(env, 'REDIS_URL')
  const agentHostToken = take(env, 'AGENT_HOST_TOKEN')
  const daemonSecret = take(env, 'DAEMON_SECRET')
  const apiOrigin = take(env, 'ATLAS_API_ORIGIN')
  const required: ReadonlyArray<[string, string | undefined]> = [
    ['DATABASE_URL', databaseUrl],
    ['DATABASE_DIRECT_URL', databaseDirectUrl],
    ['REDIS_URL', redisUrl],
    ['AGENT_HOST_TOKEN', agentHostToken],
    ['DAEMON_SECRET', daemonSecret],
    ['ATLAS_API_ORIGIN', apiOrigin],
  ]
  const missing = required.filter((pair) => pair[1] === undefined).map((pair) => pair[0])
  if (missing.length > 0) throw new AgentHostEnvError(missing)
  return {
    databaseUrl: databaseUrl as string,
    databaseDirectUrl: databaseDirectUrl as string,
    redisUrl: redisUrl as string,
    agentHostToken: agentHostToken as string,
    daemonSecret: daemonSecret as string,
    apiOrigin: apiOrigin as string,
    maxSessions: parseMaxSessions(take(env, 'AGENT_HOST_MAX_SESSIONS')),
    sandboxImage: take(env, 'ATLAS_SANDBOX_IMAGE') ?? DEFAULT_SANDBOX_IMAGE,
    daemonBundlePath: take(env, 'ATLAS_DAEMON_BUNDLE') ?? defaultDaemonBundlePath(),
  }
}
