import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

import { applyDaemonBoot } from './boot'
import { CallLedger } from './calls/ledger'
import { daemonHomeFromEnv } from './journal'
import { daemonOps } from './ops'
import { startDaemonServer } from './server'
import { DAEMON_VERSION } from './version'

const env = process.env
const port = Number(env.PORT ?? 3000)
const sandboxName = env.ATLAS_SANDBOX_NAME ?? ''
const secret = env.V2_DAEMON_SECRET ?? ''
const home = daemonHomeFromEnv(env)

applyDaemonBoot({ env })

const spawnCountFile = env.ATLAS_DAEMON_SPAWN_COUNT_FILE
const bootId = randomUUID()
const ledger = new CallLedger(
  {
    home,
    ops: daemonOps,
    env,
    ...(spawnCountFile === undefined
      ? {}
      : { onSpawn: (count: number) => writeFileSync(spawnCountFile, String(count)) }),
  },
  bootId,
)
await ledger.boot()

const server = startDaemonServer({
  config: {
    port,
    home,
    bootId,
    version: DAEMON_VERSION,
    secret,
    sandboxName,
    env,
    ops: daemonOps,
  },
  ledger,
})

console.log(`atlas-daemon ${DAEMON_VERSION} listening on ${server.port} bootId=${bootId}`)
