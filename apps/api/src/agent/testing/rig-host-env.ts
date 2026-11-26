import { join } from 'node:path'

import type { HostKnobs } from './fault-rig'

export const RIG_SECRET = 'fault-rig-secret'

export const hostEnv = (args: {
  home: string
  sandboxHome: string
  databaseUrl: string
  directUrl: string
  presenceUrl: string
  redisUrl: string
  label: string
  daemonUrl: string
  daemonUrls: Record<string, string> | undefined
  daemonUrlFile: string | undefined
  scriptFile: string
  workspace: string
  knobs: HostKnobs | undefined
  firstChunkFile: string | undefined
  setupScript: string | undefined
}): Record<string, string> => {
  const { knobs } = args
  return {
    ATLAS_HOME: args.home,
    SANDBOX_HOME: args.sandboxHome,
    DATABASE_URL: args.databaseUrl,
    DATABASE_DIRECT_URL: args.directUrl,
    PRESENCE_DATABASE_URL: args.presenceUrl,
    REDIS_URL: args.redisUrl,
    HOLDER_ID: args.label,
    DAEMON_URL: args.daemonUrl,
    DAEMON_SECRET: RIG_SECRET,
    SCRIPT_FILE: args.scriptFile,
    WORKSPACE_DIR: args.workspace,
    ...(args.setupScript === undefined ? {} : { SETUP_SCRIPT: args.setupScript }),
    APPEND_RETRY_MS: String(knobs?.appendRetryMs ?? 2_500),
    ...(knobs?.drainCapMs === undefined ? {} : { DRAIN_CAP_MS: String(knobs.drainCapMs) }),
    PING_MS: String(knobs?.pingMs ?? 10_000),
    ...(args.daemonUrls === undefined ? {} : { DAEMON_URLS: JSON.stringify(args.daemonUrls) }),
    ...(args.daemonUrlFile === undefined ? {} : { DAEMON_URL_FILE: args.daemonUrlFile }),
    ...(knobs?.noRing === true ? { NO_RING: '1' } : {}),
    ...(knobs?.poolMax === undefined ? {} : { DATABASE_POOL_MAX: String(knobs.poolMax) }),
    ...(knobs?.queryTimeoutMs === undefined
      ? {}
      : { DB_QUERY_TIMEOUT_MS: String(knobs.queryTimeoutMs) }),
    ...(knobs?.toolOutputFile === undefined ? {} : { TOOL_OUTPUT_FILE: knobs.toolOutputFile }),
    ...(knobs?.sweepMs === undefined ? {} : { SWEEP_MS: String(knobs.sweepMs) }),
    ...(knobs?.fault === undefined ? {} : { FAULT: knobs.fault }),
    ...(args.firstChunkFile === undefined ? {} : { FIRST_CHUNK_FILE: args.firstChunkFile }),
    ...(knobs?.plugins === true ? { FAULT_PLUGINS: '1' } : {}),
    ...(knobs?.faultTools === true ? { FAULT_TOOLS: '1' } : {}),
    ...(knobs?.faultResources === true ? { FAULT_RESOURCES: '1' } : {}),
    ...(knobs?.pluginToolGate === undefined
      ? {}
      : { PLUGIN_TOOL_GATE: JSON.stringify(knobs.pluginToolGate) }),
    ...(knobs?.modelRequestsFile === undefined
      ? {}
      : { MODEL_REQUESTS_FILE: knobs.modelRequestsFile }),
    ...(knobs?.contextMirrorDir === undefined
      ? {}
      : { CONTEXT_MIRROR_DIR: knobs.contextMirrorDir }),
    ...(knobs?.notifyLog === true ? { NOTIFY_FILE: join(args.workspace, 'notify.jsonl') } : {}),
    ...(knobs?.podResizeLog === true
      ? { POD_RESIZE_FILE: join(args.workspace, 'pod-resize.jsonl') }
      : {}),
  }
}
