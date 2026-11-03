import { randomUUID } from 'node:crypto'

import { DaemonEngine } from '@dltech/atlas-protocol/engine'

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
let secret: string
let sandboxName: string
try {
  secret = required({ env, name: 'V2_DAEMON_SECRET' })
  sandboxName = required({ env, name: 'ATLAS_SANDBOX_NAME' })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(78)
}
delete env.V2_DAEMON_SECRET

const home = daemonHomeFromEnv(env)
const protection = protectDaemon(env)
const bootId = randomUUID()
const engine = new DaemonEngine({
  bootId,
  version: DAEMON_VERSION,
  secret,
  sandboxName,
  store: new DiskCallStore(home),
  groups: daemonGroups({ env, home }),
  health: () => {
    const memory = workMemory(env)
    return { protection, ...(memory === undefined ? {} : { memory }) }
  },
  onFault: ({ key, error }) => {
    console.error(`atlas-daemon fault${key === undefined ? '' : ` on ${key}`}:`, error)
  },
})
await engine.open()

const listener = listenWebSocket({ engine, port: Number(env.PORT ?? 3000) })

const handleSignal = (): void => {
  listener.stop()
  void engine.stop().then(() => process.exit(0))
}
process.on('SIGTERM', handleSignal)
process.on('SIGINT', handleSignal)

console.log(
  `atlas-daemon ${DAEMON_VERSION} listening on ${listener.port} bootId=${bootId} protection=${JSON.stringify(protection)}`,
)
