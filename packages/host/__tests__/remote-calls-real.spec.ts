import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe } from 'bun:test'

import { daemonTestEnv, spawnDaemon } from '@dltech/atlas-daemon/testing'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { webSocketConnector, type DaemonConnector } from '../src'
import { describeRemoteCalls, type RemoteCallsHandle } from '../src/testing'

const SANDBOX = 'atlas-v2-conformance'
const SECRET = 'conformance-secret'
const ENTRY = join(import.meta.dir, '../../../apps/daemon/src/index.ts')

const realHandle = async (): Promise<RemoteCallsHandle> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-host-test-'))
  let running = await spawnDaemon({ entry: ENTRY, env: daemonTestEnv(home) })
  const kill = async (): Promise<void> => {
    running.child.kill('SIGKILL')
    await running.child.exited
  }
  return {
    token: daemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connectorFor: () => () =>
      Promise.resolve<DaemonConnector>(
        webSocketConnector({ url: `ws://127.0.0.1:${running.port}` }),
      ),
    restart: async () => {
      await kill()
      running = await spawnDaemon({ entry: ENTRY, env: daemonTestEnv(home) })
    },
    runCount: () => undefined,
    stop: async () => {
      await kill()
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe('real daemon target', () => {
  describeRemoteCalls({ name: 'real', start: realHandle })
})
