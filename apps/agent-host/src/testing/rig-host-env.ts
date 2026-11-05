import type { HostKnobs } from './fault-rig'

export const RIG_SECRET = 'fault-rig-secret'

export const hostEnv = (args: {
  home: string
  databaseUrl: string
  directUrl: string
  presenceUrl: string
  redisUrl: string
  label: string
  daemonUrl: string
  daemonUrls: Record<string, string> | undefined
  scriptFile: string
  workspace: string
  knobs: HostKnobs | undefined
  firstChunkFile: string | undefined
}): Record<string, string> => {
  const { knobs } = args
  return {
    ATLAS_HOME: args.home,
    DATABASE_URL: args.databaseUrl,
    DATABASE_DIRECT_URL: args.directUrl,
    PRESENCE_DATABASE_URL: args.presenceUrl,
    REDIS_URL: args.redisUrl,
    HOLDER_ID: args.label,
    DAEMON_URL: args.daemonUrl,
    DAEMON_SECRET: RIG_SECRET,
    SCRIPT_FILE: args.scriptFile,
    WORKSPACE_DIR: args.workspace,
    APPEND_RETRY_MS: String(knobs?.appendRetryMs ?? 2_500),
    PING_MS: String(knobs?.pingMs ?? 10_000),
    ...(args.daemonUrls === undefined ? {} : { DAEMON_URLS: JSON.stringify(args.daemonUrls) }),
    ...(knobs?.drainMs === undefined ? {} : { DRAIN_MS: String(knobs.drainMs) }),
    ...(knobs?.noRing === true ? { NO_RING: '1' } : {}),
    ...(knobs?.poolMax === undefined ? {} : { DATABASE_POOL_MAX: String(knobs.poolMax) }),
    ...(knobs?.maxSessions === undefined ? {} : { MAX_SESSIONS: String(knobs.maxSessions) }),
    ...(knobs?.queryTimeoutMs === undefined
      ? {}
      : { DB_QUERY_TIMEOUT_MS: String(knobs.queryTimeoutMs) }),
    ...(knobs?.toolOutputFile === undefined ? {} : { TOOL_OUTPUT_FILE: knobs.toolOutputFile }),
    ...(args.firstChunkFile === undefined ? {} : { FIRST_CHUNK_FILE: args.firstChunkFile }),
  }
}
