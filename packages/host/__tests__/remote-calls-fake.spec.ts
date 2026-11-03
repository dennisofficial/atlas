import { describe } from 'bun:test'

import { createInMemoryDaemon, inMemoryDaemonToken } from '@dltech/atlas-protocol/testing'

import type { DaemonConnector } from '../src'
import { describeRemoteCalls, type RemoteCallsHandle } from '../src/testing'

const SANDBOX = 'atlas-v2-host-test'
const SECRET = 'host-test-secret'

const fakeHandle = async (): Promise<RemoteCallsHandle> => {
  const daemon = await createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
  })
  return {
    token: inMemoryDaemonToken({ secret: SECRET, sandboxName: SANDBOX }),
    connectorFor: () => () =>
      Promise.resolve<DaemonConnector>((handlers) => Promise.resolve(daemon.connectRaw(handlers))),
    restart: () => daemon.restart(),
    runCount: () => daemon.runCount(),
    stop: () => daemon.stop(),
  }
}

describe('fake daemon target', () => {
  describeRemoteCalls({ name: 'fake', start: fakeHandle })
})
