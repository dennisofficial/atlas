import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'

import {
  DAEMON_LINK_PROTOCOL_MIN_VERSION,
  DAEMON_LINK_PROTOCOL_VERSION,
  DAEMON_PORT,
  DAEMON_PORT_ENV,
  DAEMON_RESTART_HINT_ENV,
  EDaemonCapability,
} from '@dltech/atlas-protocol'
import { DaemonEngine } from '@dltech/atlas-protocol/engine'

import { isAtlasVolumeMounted } from './atlas-volume'
import { ATLAS_VOLUME_BUN_CACHE, sanitizeChildEnv, withVolumeBunCache } from './child-env'
import { daemonCpuReadingOf } from './cpu'
import { DiskCallStore, daemonHomeFromEnv } from './disk-store'
import { daemonGroups } from './ops'
import { protectDaemon, workMemory } from './protection'
import { listenWebSocket } from './transport'
import { DAEMON_VERSION } from './version'

const required = (args: { env: Record<string, string | undefined>; name: string }): string => {
  const value = args.env[args.name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`atlas-daemon refuses to start without ${args.name}`)
  }
  return value
}

const env = process.env
let token: string
try {
  token = required({ env, name: 'DAEMON_TOKEN' })
  required({ env, name: 'ATLAS_SANDBOX_NAME' })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(78)
}
delete env.DAEMON_TOKEN

const home = daemonHomeFromEnv(env)
const protection = protectDaemon(env)
const atlasVolumeMounted = (): boolean => {
  try {
    return isAtlasVolumeMounted(readFileSync('/proc/mounts', 'utf8'))
  } catch {
    return false
  }
}
const ensureBunCacheDir = (): void => {
  try {
    mkdirSync(ATLAS_VOLUME_BUN_CACHE, { recursive: true })
  } catch (error) {
    console.error(`atlas-daemon could not create ${ATLAS_VOLUME_BUN_CACHE}: ${String(error)}`)
  }
}
const atlasVolume = atlasVolumeMounted()
if (atlasVolume) ensureBunCacheDir()
const childEnv = withVolumeBunCache({ env: sanitizeChildEnv(env), atlasVolume })
const bootId = randomUUID()
const engine = new DaemonEngine({
  bootId,
  version: DAEMON_VERSION,
  token,
  store: new DiskCallStore(home),
  groups: daemonGroups({ env: childEnv, home }),
  capabilities: [
    EDaemonCapability.ExecDeadline,
    EDaemonCapability.McpRequest,
    EDaemonCapability.CancelScope,
  ],
  health: () => {
    const memory = workMemory(env)
    return { protection, ...(memory === undefined ? {} : { memory }) }
  },
  onFault: ({ key, error }) => {
    console.error(`atlas-daemon fault${key === undefined ? '' : ` on ${key}`}:`, error)
  },
})
await engine.open()

let drained = false
const handleDrain = (deadlineMs: number): void => {
  if (drained) return
  drained = true
  console.log('atlas-daemon draining')
  void engine
    .drain({ deadlineMs })
    .then(() => {
      listener.stop()
      return engine.stop()
    })
    .then(() => process.exit(0))
}

const handleRestart = async (bundleUrl?: string | undefined): Promise<void> => {
  if (drained) return
  drained = true
  const hintPath = env[DAEMON_RESTART_HINT_ENV]
  if (bundleUrl !== undefined && hintPath !== undefined && hintPath !== '') {
    await writeFile(hintPath, `${bundleUrl}\n`).catch((error: unknown) => {
      console.error(`atlas-daemon could not record its restart bundle: ${String(error)}`)
    })
  }
  console.log('atlas-daemon restarting')
  setTimeout(() => {
    listener.stop()
    void engine.stop().then(() => process.exit(0))
  }, 100)
}

const listener = listenWebSocket({
  engine,
  port: Number(env[DAEMON_PORT_ENV] ?? DAEMON_PORT),
  token,
  version: DAEMON_VERSION,
  protocol: DAEMON_LINK_PROTOCOL_VERSION,
  minProtocol: DAEMON_LINK_PROTOCOL_MIN_VERSION,
  drain: handleDrain,
  restart: handleRestart,
  cpu: () => daemonCpuReadingOf(),
})

const handleSignal = (): void => {
  listener.stop()
  void engine.stop().then(() => process.exit(0))
}
process.on('SIGTERM', handleSignal)
process.on('SIGINT', handleSignal)

console.log(
  `atlas-daemon ${DAEMON_VERSION} listening on ${listener.port} bootId=${bootId} protection=${JSON.stringify(protection)}`,
)
